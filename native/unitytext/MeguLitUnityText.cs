// SPDX-License-Identifier: GPL-3.0-or-later
// MeguLitUnityText.dll: text architecture ③ for Unity (Mono) games (docs/text-architecture.md). A BepInEx 5 plugin
// (BepInEx: LGPL-2.1, loaded through UnityDoorstop from MeguLit's per-game shadow folder, never the game's own folder).
// It hooks nothing: twice a second it looks at the game's live text components (TextMeshPro TMP_Text and uGUI Text,
// found by type name, so no TextMeshPro version is compiled in) and picks the dialogue one, the visible component
// whose text is the line MeguLit's text hook read (sent over the control socket as WANT), or, without one, the visible
// component with the most kana/kanji that changed last. Then, every frame:
//   - while MeguLit asks for it (HIDE 1) that one component is drawn at alpha 0 (TMP_Text.alpha / Graphic.color.a);
//     its text, layout, wrapping, typewriter and click wait stay the game's own. Its own alpha is restored the moment
//     MeguLit stops asking, the socket drops, or the dialogue moves to another component;
//   - each character's box is read from the laid-out mesh (TMP textInfo.characterInfo / TextGenerator verts), mapped
//     to screen pixels through the component's canvas camera, and reported as one ToMe_CHARS record when it changes.
// hidden=1 only when the alpha is still 0 at the end of the frame (a game that animates the colour itself wins and the
// line stays the game's). Nothing in the game's saves, PlayerPrefs or files is written. Protocol: core/text-paths.cjs.
using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Net.Sockets;
using System.Reflection;
using System.Text;
using System.Threading;
using BepInEx;
using UnityEngine;

[BepInPlugin("com.megulit.unitytext", "MeguLit Unity Text", "1.0.0")]
public class MeguLitUnityText : BaseUnityPlugin {
 // ---- control socket (127.0.0.1, port from MeguLitUnityText.port next to this DLL) ----------------------------------
 readonly object gate = new object();
 readonly Queue<string> outbox = new Queue<string>();
 volatile string wanted = "";
 volatile bool hideAsked, connected;
 Thread net;

 void Awake() {
  string dir = Path.GetDirectoryName(Info.Location);
  int port;
  string file = Path.Combine(dir, "MeguLitUnityText.port");
  if (!File.Exists(file) || !int.TryParse(File.ReadAllText(file).Trim(), out port)) { Logger.LogInfo("no MeguLit control port: idle"); enabled = false; return; }
  net = new Thread(() => Net(port)) { IsBackground = true, Name = "MeguLitUnityText" };
  net.Start();
  StartCoroutine(EndOfFrame());
 }

 void Send(string line) { lock (gate) { if (outbox.Count > 256) outbox.Dequeue(); outbox.Enqueue(line.Replace("\r", " ").Replace("\n", "\u001f")); } }

 void Net(int port) {
  while (true) {
   try {
    using (var client = new TcpClient()) {
     client.Connect("127.0.0.1", port);
     client.NoDelay = true;
     var stream = client.GetStream();
     connected = true;
     Send("ToMe_UNITY status ok unity=" + Application.unityVersion);
     var inbuf = new StringBuilder();
     var buf = new byte[8192];
     while (true) {
      while (client.Available > 0) {
       int n = stream.Read(buf, 0, buf.Length);
       if (n <= 0) throw new IOException("closed");
       inbuf.Append(Encoding.UTF8.GetString(buf, 0, n));
       string all = inbuf.ToString();
       int at;
       while ((at = all.IndexOf('\n')) >= 0) { Command(all.Substring(0, at).TrimEnd('\r')); all = all.Substring(at + 1); }
       inbuf.Length = 0; inbuf.Append(all);
      }
      string[] items = null;
      lock (gate) { if (outbox.Count > 0) { items = outbox.ToArray(); outbox.Clear(); } }
      if (items != null) { var data = Encoding.UTF8.GetBytes(string.Join("\n", items) + "\n"); stream.Write(data, 0, data.Length); }
      if (client.Client.Poll(0, SelectMode.SelectRead) && client.Available == 0) throw new IOException("closed");
      Thread.Sleep(15);
     }
    }
   } catch (Exception) {
    connected = false; hideAsked = false;
    Thread.Sleep(1000);
   }
  }
 }

 void Command(string line) {
  if (line.StartsWith("HIDE ")) hideAsked = line.EndsWith("1");
  else if (line.StartsWith("WANT ")) wanted = line.Substring(5).Replace("\u001f", "\n");
 }

 // ---- components by type name ----------------------------------------------------------------------------------
 Type tmpType, uguiText, graphic;
 PropertyInfo uRich, tmpText, tmpAlpha, tmpInfo, uText, uColor, uGen, uPpu;
 FieldInfo ciPoint, ciIndex, infoCount, infoChars, ciChar, ciVisible, ciBL, ciTR;
 bool typesTried;

 void FindTypes() {
  if (typesTried) return; typesTried = true;
  foreach (var a in AppDomain.CurrentDomain.GetAssemblies()) {
   if (tmpType == null) tmpType = a.GetType("TMPro.TMP_Text", false);
   if (uguiText == null) uguiText = a.GetType("UnityEngine.UI.Text", false);
   if (graphic == null) graphic = a.GetType("UnityEngine.UI.Graphic", false);
  }
  if (tmpType != null) {
   tmpText = tmpType.GetProperty("text"); tmpAlpha = tmpType.GetProperty("alpha"); tmpInfo = tmpType.GetProperty("textInfo");
   var ti = tmpInfo != null ? tmpInfo.PropertyType : null;
   if (ti != null) { infoCount = ti.GetField("characterCount"); infoChars = ti.GetField("characterInfo"); }
   var ci = infoChars != null ? infoChars.FieldType.GetElementType() : null;
   if (ci != null) { ciChar = ci.GetField("character"); ciIndex = ci.GetField("index"); ciPoint = ci.GetField("pointSize"); ciVisible = ci.GetField("isVisible"); ciBL = ci.GetField("bottomLeft"); ciTR = ci.GetField("topRight"); }
  }
  if (uguiText != null) { uText = uguiText.GetProperty("text"); uGen = uguiText.GetProperty("cachedTextGenerator"); uRich = uguiText.GetProperty("supportRichText"); uPpu = uguiText.GetProperty("pixelsPerUnit"); }
  if (graphic != null) uColor = graphic.GetProperty("color");
  Logger.LogInfo("text types: tmp=" + (tmpType != null) + " ugui=" + (uguiText != null));
 }

 // ---- the dialogue component ------------------------------------------------------------------------------------
 Component current; bool hidingCurrent; float nextScan; string lastKey = ""; int line; string lastText = "";
 readonly Dictionary<int, string> seen = new Dictionary<int, string>();
 readonly Dictionary<int, float> changedAt = new Dictionary<int, float>();

 static string Norm(string s) { var b = new StringBuilder(); bool tag = false; foreach (char c in s ?? "") { if (c == '<') tag = true; else if (c == '>') tag = false; else if (!tag && !char.IsWhiteSpace(c) && c != '　') b.Append(c); } return b.ToString(); }
 static int Cjk(string s) { int n = 0; foreach (char c in s) if (c >= 0x3040 && c <= 0x30ff || c >= 0x4e00 && c <= 0x9fff) n++; return n; }
 string TextOf(Component c) { try { var p = tmpType != null && tmpType.IsInstanceOfType(c) ? tmpText : uText; return p != null ? (string)p.GetValue(c, null) : ""; } catch { return ""; } }
 static bool Shown(Component c) { var b = c as Behaviour; return c != null && c.gameObject.activeInHierarchy && (b == null || b.enabled); }
 // A candidate must really be seen: not faded out by its own colour or a CanvasGroup, and on screen (a backlog or a
 // template kept active but transparent or parked outside the view is not the dialogue).
 bool Seen(Component c) {
  if (GetAlpha(c) < 0.02f) return false;
  foreach (var g in c.GetComponentsInParent<CanvasGroup>(true)) { if (g.alpha < 0.02f) return false; if (g.ignoreParentGroups) break; }
  var rt = c.transform as RectTransform; if (rt == null) return true;
  var corners = new Vector3[4]; rt.GetWorldCorners(corners); var cam = CameraOf(c);
  Vector2 a = Screen2(cam, corners[0]), b = Screen2(cam, corners[2]);
  return Math.Max(a.x, b.x) > 0 && Math.Min(a.x, b.x) < Screen.width && Math.Max(a.y, b.y) > 0 && Math.Min(a.y, b.y) < Screen.height;
 }

 void Scan() {
  FindTypes();
  var list = new List<Component>();
  foreach (var t in new[] { tmpType, uguiText }) if (t != null) foreach (var o in UnityEngine.Object.FindObjectsOfType(t)) { var c = o as Component; if (Shown(c) && Seen(c)) list.Add(c); }
  string want = Norm(wanted);
  Component best = null; float bestAt = -1; int bestLen = 0;
  foreach (var c in list) {
   string t = Norm(TextOf(c)); int id = c.GetInstanceID(); string old;
   if (!seen.TryGetValue(id, out old) || old != t) { seen[id] = t; changedAt[id] = Time.unscaledTime; }
   if (t.Length == 0) continue;
   if (want.Length >= 2) { if (want.StartsWith(t) && t.Length >= Math.Min(4, want.Length) || t.Contains(want)) { if (best == null || t.Length < bestLen || best != null && Norm(TextOf(best)).Length > t.Length) { best = c; bestLen = t.Length; } } continue; }
   int k = Cjk(t); float at; changedAt.TryGetValue(id, out at);
   if (k >= 2 && (at > bestAt || at == bestAt && k > bestLen)) { best = c; bestAt = at; bestLen = k; }
  }
  if (best != current) { Restore(); current = best; }
 }

 // ---- hide / restore --------------------------------------------------------------------------------------------
 float GetAlpha(Component c) { try { if (tmpType != null && tmpType.IsInstanceOfType(c)) return (float)tmpAlpha.GetValue(c, null); return ((Color)uColor.GetValue(c, null)).a; } catch { return 1f; } }
 void SetAlpha(Component c, float a) { try { if (tmpType != null && tmpType.IsInstanceOfType(c)) tmpAlpha.SetValue(c, a, null); else { var col = (Color)uColor.GetValue(c, null); col.a = a; uColor.SetValue(c, col, null); } } catch { } }
 // Hidden through the CanvasRenderers (the component's and its sub-meshes'): their alpha multiplies whatever colours the
 // game animates into the mesh (live 2026-11-14, IL2CPP 魔法少女ノ魔女裁判: a typewriter rewrote vertex colours, so the
 // component's own alpha was not enough). Text without a CanvasRenderer: its Renderers off, else the component alpha.
 readonly Dictionary<int, float> saved = new Dictionary<int, float>();
 void HideSet(Component c, bool on) {
  bool any = false;
  foreach (var cr in c.GetComponentsInChildren<CanvasRenderer>(true)) {
   any = true; int k = cr.GetInstanceID(); float a;
   if (on) { if (!saved.ContainsKey(k)) saved[k] = cr.GetAlpha(); if (cr.GetAlpha() != 0f) cr.SetAlpha(0f); }
   else if (saved.TryGetValue(k, out a)) { cr.SetAlpha(a <= 0f ? 1f : a); saved.Remove(k); }
  }
  if (!any) foreach (var r in c.GetComponentsInChildren<Renderer>(true)) {
   any = true; int k = r.GetInstanceID(); float a;
   if (on) { if (!saved.ContainsKey(k)) saved[k] = r.enabled ? 1f : 0f; if (r.enabled) r.enabled = false; }
   else if (saved.TryGetValue(k, out a)) { r.enabled = a > 0f; saved.Remove(k); }
  }
  if (!any) { int k = c.GetInstanceID(); float a; if (on) { if (!saved.ContainsKey(k)) saved[k] = GetAlpha(c); SetAlpha(c, 0f); } else if (saved.TryGetValue(k, out a)) { SetAlpha(c, a <= 0f ? 1f : a); saved.Remove(k); } }
 }
 bool AllHidden(Component c) {
  bool any = false;
  foreach (var cr in c.GetComponentsInChildren<CanvasRenderer>(true)) { any = true; if (cr.GetAlpha() > 0f) return false; }
  if (any) return true;
  foreach (var r in c.GetComponentsInChildren<Renderer>(true)) { any = true; if (r.enabled) return false; }
  return any || GetAlpha(c) <= 0f;
 }
 void Restore() { if (hidingCurrent && current != null) HideSet(current, false); hidingCurrent = false; saved.Clear(); }

 void LateUpdate() {
  if (Time.unscaledTime >= nextScan) { nextScan = Time.unscaledTime + 0.5f; try { Scan(); } catch (Exception e) { Logger.LogWarning("scan " + e.Message); } }
  if (current == null || !Shown(current)) { Restore(); current = null; return; }
  bool want = hideAsked && connected;
  if (want && !hidingCurrent) hidingCurrent = true;
  if (!want) Restore();
  if (hidingCurrent) HideSet(current, true);
 }

 IEnumerator EndOfFrame() {
  var wait = new WaitForEndOfFrame();
  while (true) {
   yield return wait;
   try { if (current != null && connected) Report(); } catch (Exception e) { Logger.LogWarning("report " + e.Message); }
  }
 }

 // ---- character boxes -----------------------------------------------------------------------------------------------
 static Camera CameraOf(Component c) {
  var all = c.GetComponentsInParent<Canvas>(true);
  if (all == null || all.Length == 0) return Camera.main; // world-space TextMeshPro
  var canvas = all[all.Length - 1]; // the root canvas decides the render mode
  return canvas.renderMode == RenderMode.ScreenSpaceOverlay ? null : (canvas.worldCamera ?? Camera.main);
 }
 static Vector2 Screen2(Camera cam, Vector3 world) { return cam == null ? new Vector2(world.x, world.y) : (Vector2)cam.WorldToScreenPoint(world); }

 void Report() {
  var all = new List<KeyValuePair<char, float[]>>();
  var cam = CameraOf(current); var tr = current.transform; float sh = Screen.height;
  Action<char, Vector3, Vector3> add = (ch, bl, trc) => {
   Vector2 a = Screen2(cam, tr.TransformPoint(bl)), b = Screen2(cam, tr.TransformPoint(trc));
   float x = Math.Min(a.x, b.x), top = sh - Math.Max(a.y, b.y), w = Math.Abs(b.x - a.x), h = Math.Abs(b.y - a.y);
   if (w <= 0 || h <= 0 || char.IsWhiteSpace(ch) || ch == '　') return;
   all.Add(new KeyValuePair<char, float[]>(ch, new[] { x, top, w, h }));
  };
  if (tmpType != null && tmpType.IsInstanceOfType(current)) {
   object info = tmpInfo.GetValue(current, null); int n = (int)infoCount.GetValue(info); var arr = (Array)infoChars.GetValue(info);
   // ruby: characters set in a clearly smaller point size than the line's body are left out
   var sizes = new List<float>(); if (ciPoint != null) for (int i = 0; i < n && i < arr.Length; i++) { object e = arr.GetValue(i); if ((bool)ciVisible.GetValue(e)) sizes.Add(Convert.ToSingle(ciPoint.GetValue(e))); }
   sizes.Sort(); float body = sizes.Count > 0 ? sizes[sizes.Count / 2] : 0f;
   for (int i = 0; i < n && i < arr.Length; i++) {
    object ci = arr.GetValue(i);
    if (!(bool)ciVisible.GetValue(ci)) continue;
    if (body > 0 && Convert.ToSingle(ciPoint.GetValue(ci)) < body * 0.75f) continue;
    add((char)ciChar.GetValue(ci), (Vector3)ciBL.GetValue(ci), (Vector3)ciTR.GetValue(ci));
   }
  } else if (uGen != null) {
   var gen = (TextGenerator)uGen.GetValue(current, null); float ppu = uPpu != null ? (float)uPpu.GetValue(current, null) : 1f; if (ppu <= 0) ppu = 1f;
   // Which characters got a quad differs by Unity version: rich-text tags (empty quads before 2019, none after),
   // spaces and line breaks (none since 2019.1). The sequence whose length matches the quad count is the one drawn.
   string raw = TextOf(current) ?? ""; int quads = gen.verts.Count / 4; var verts = gen.verts;
   bool rich = uRich == null || (bool)uRich.GetValue(current, null);
   string plain = rich ? System.Text.RegularExpressions.Regex.Replace(raw, "</?(b|i|size|color|material|quad)(=[^>]*)?>", "") : raw;
   string s = null;
   foreach (var cand in new[] { Keep(plain, false), Keep(plain, true), plain, Keep(raw, false), Keep(raw, true), raw }) if (cand.Length == quads) { s = cand; break; }
   if (s == null) s = Keep(plain, false);
   for (int i = 0, ci = 0; i + 3 < verts.Count && ci < s.Length; i += 4, ci++) {
    Vector3 p0 = verts[i].position / ppu, p2 = verts[i + 2].position / ppu;
    add(s[ci], new Vector3(Math.Min(p0.x, p2.x), Math.Min(p0.y, p2.y), 0), new Vector3(Math.Max(p0.x, p2.x), Math.Max(p0.y, p2.y), 0));
   }
  }
  if (all.Count == 0) return;
  // Quads far smaller than the line's glyphs in both directions are not readable characters (markup some games leave as near-empty
  // glyphs, underline / cursor quads): left out, so the record holds what a reader sees.
  var hs = new List<float>(); foreach (var e in all) hs.Add(e.Value[3]); hs.Sort(); float median = hs[hs.Count / 2];
  var rects = new List<float[]>(); var text = new StringBuilder(); float prevTop = float.NaN;
  foreach (var e in all) {
   var r = e.Value; if (r[3] < median * 0.15f && r[2] < median * 0.15f) continue; // both sides tiny: a long dash (一 ー) is flat but wide
   float mid = r[1] + r[3] / 2; // row change by glyph centre: kana and punctuation sit lower than kanji
   if (!float.IsNaN(prevTop) && Math.Abs(mid - prevTop) > median * 0.9f) text.Append('\n');
   prevTop = mid; text.Append(e.Key); rects.Add(r);
  }
  if (rects.Count == 0) return;
  string flat = text.ToString().Replace("\n", "");
  if (!(lastText.Length > 0 && (flat.StartsWith(lastText) || lastText.StartsWith(flat)))) line++;
  bool hidden = hidingCurrent && AllHidden(current);
  var sb = new StringBuilder();
  foreach (var r in rects) { if (sb.Length > 0) sb.Append(';'); sb.Append(F(r[0])).Append(',').Append(F(r[1])).Append(',').Append(F(r[2])).Append(',').Append(F(r[3])); }
  string key = line + "|" + hidden + "|" + sb;
  if (key == lastKey) return;
  lastKey = key; lastText = flat;
  Send("ToMe_CHARS engine=unity line=" + line + " hidden=" + (hidden ? 1 : 0) + " sw=" + Screen.width + " sh=" + Screen.height + " vx=0 vy=0 vw=" + Screen.width + " vh=" + Screen.height + " n=" + rects.Count + " rects=" + sb + " text=" + text);
 }
 static string Keep(string s, bool blanks) { var b = new StringBuilder(); foreach (char c in s) if (c != (char)10 && c != (char)13 && (blanks || !char.IsWhiteSpace(c))) b.Append(c); return b.ToString(); }
 static string F(float v) { return Math.Round(v, 1).ToString(System.Globalization.CultureInfo.InvariantCulture); }

 void OnDestroy() { Restore(); }
}
