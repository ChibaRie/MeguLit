// SPDX-License-Identifier: GPL-3.0-or-later
// MeguLitUnityText.IL2CPP.dll: text architecture ③ for Unity IL2CPP games (docs/text-architecture.md). The same job as
// MeguLitUnityText.cs (Mono) on BepInEx 6's IL2CPP build (Il2CppInterop): pick the dialogue component (TextMeshPro
// TMP_Text, uGUI Text), draw it at alpha 0 while MeguLit asks, report each character's box as ToMe_CHARS. It compiles
// against the interop assemblies BepInEx generates (UnityEngine.*, Unity.TextMeshPro); they bind by type and member
// name at run time, so one build serves any game whose generated interop has the same Unity / TextMeshPro members.
// It hooks nothing and writes no game data. Control: loopback TCP, port from MeguLitUnityText.port next to this DLL.
using System;
using System.Collections.Generic;
using System.IO;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using BepInEx;
using BepInEx.Unity.IL2CPP;
using Il2CppInterop.Runtime;
using UnityEngine;
using TMPro;

[BepInPlugin("com.megulit.unitytext.il2cpp", "MeguLit Unity Text (IL2CPP)", "1.0.0")]
public class MeguLitUnityTextIl2Cpp : BasePlugin {
 internal static MeguLitUnityTextIl2Cpp Instance;
 internal readonly object Gate = new object();
 internal readonly Queue<string> Outbox = new Queue<string>();
 internal volatile string Wanted = "";
 internal volatile bool HideAsked, Connected;

 public override void Load() {
  Instance = this;
  string dir = Path.GetDirectoryName(typeof(MeguLitUnityTextIl2Cpp).Assembly.Location);
  int port;
  string file = Path.Combine(dir, "MeguLitUnityText.port");
  if (!File.Exists(file) || !int.TryParse(File.ReadAllText(file).Trim(), out port)) { Log.LogInfo("no MeguLit control port: idle"); return; }
  var net = new Thread(() => Net(port)) { IsBackground = true, Name = "MeguLitUnityText" };
  net.Start();
  AddComponent<MeguLitTextDriver>();
 }

 internal void Send(string line) { lock (Gate) { if (Outbox.Count > 256) Outbox.Dequeue(); Outbox.Enqueue(line.Replace("\r", " ").Replace("\n", "\u001f")); } }

 void Net(int port) {
  while (true) {
   try {
    using (var client = new TcpClient()) {
     client.Connect("127.0.0.1", port);
     client.NoDelay = true;
     var stream = client.GetStream();
     Connected = true;
     Send("ToMe_UNITY status ok il2cpp unity=" + Application.unityVersion);
     var inbuf = new StringBuilder(); var buf = new byte[8192];
     while (true) {
      while (client.Available > 0) {
       int n = stream.Read(buf, 0, buf.Length); if (n <= 0) throw new IOException("closed");
       inbuf.Append(Encoding.UTF8.GetString(buf, 0, n));
       string all = inbuf.ToString(); int at;
       while ((at = all.IndexOf('\n')) >= 0) { Command(all.Substring(0, at).TrimEnd('\r')); all = all.Substring(at + 1); }
       inbuf.Clear(); inbuf.Append(all);
      }
      string[] items = null;
      lock (Gate) { if (Outbox.Count > 0) { items = Outbox.ToArray(); Outbox.Clear(); } }
      if (items != null) { var data = Encoding.UTF8.GetBytes(string.Join("\n", items) + "\n"); stream.Write(data, 0, data.Length); }
      if (client.Client.Poll(0, SelectMode.SelectRead) && client.Available == 0) throw new IOException("closed");
      Thread.Sleep(15);
     }
    }
   } catch (Exception) { Connected = false; HideAsked = false; Thread.Sleep(1000); }
  }
 }
 void Command(string line) {
  if (line.StartsWith("HIDE ")) HideAsked = line.EndsWith("1");
  else if (line.StartsWith("WANT ")) Wanted = line.Substring(5).Replace("\u001f", "\n");
 }
}

public class MeguLitTextDriver : MonoBehaviour {
 public MeguLitTextDriver(IntPtr ptr) : base(ptr) { }

 Component current; bool currentIsTmp; bool hiding; float nextScan; string lastKey = "", lastText = ""; int line;
 readonly Dictionary<int, string> seen = new Dictionary<int, string>();
 readonly Dictionary<int, float> changedAt = new Dictionary<int, float>();

 static string Norm(string s) { var b = new StringBuilder(); bool tag = false; foreach (char c in s ?? "") { if (c == '<') tag = true; else if (c == '>') tag = false; else if (!tag && !char.IsWhiteSpace(c) && c != '　') b.Append(c); } return b.ToString(); }
 static int Cjk(string s) { int n = 0; foreach (char c in s) if (c >= 0x3040 && c <= 0x30ff || c >= 0x4e00 && c <= 0x9fff) n++; return n; }

 static string TextOf(Component c, bool tmp) { try { return tmp ? c.Cast<TMP_Text>().text : c.Cast<UnityEngine.UI.Text>().text; } catch { return ""; } }
 static float GetAlpha(Component c, bool tmp) { try { return tmp ? c.Cast<TMP_Text>().alpha : c.Cast<UnityEngine.UI.Text>().color.a; } catch { return 1f; } }
 static void SetAlpha(Component c, bool tmp, float a) { try { if (tmp) c.Cast<TMP_Text>().alpha = a; else { var t = c.Cast<UnityEngine.UI.Text>(); var col = t.color; col.a = a; t.color = col; } } catch { } }
 // Hidden through the CanvasRenderers (the component's and its TMP sub-meshes'): the renderer alpha multiplies whatever
 // colours the game animates into the mesh (live 2026-11-14 魔法少女ノ魔女裁判: a typewriter rewrote vertex colours, so
 // TMP_Text.alpha 0 was not enough). World-space text without a CanvasRenderer falls back to the component's alpha.
 readonly Dictionary<IntPtr, float> saved = new Dictionary<IntPtr, float>();
 bool HideSet(Component c, bool tmp, bool on) {
  var crs = c.GetComponentsInChildren<CanvasRenderer>(true); bool any = false;
  foreach (var cr in crs) {
   any = true; IntPtr k = cr.Pointer;
   if (on) { if (!saved.ContainsKey(k)) saved[k] = cr.GetAlpha(); if (cr.GetAlpha() != 0f) cr.SetAlpha(0f); }
   else { float a; if (saved.TryGetValue(k, out a)) { cr.SetAlpha(a <= 0f ? 1f : a); saved.Remove(k); } }
  }
  if (!any) { foreach (var r in c.GetComponentsInChildren<Renderer>(true)) { any = true; IntPtr k = r.Pointer; if (on) { if (!saved.ContainsKey(k)) saved[k] = r.enabled ? 1f : 0f; if (r.enabled) r.enabled = false; } else { float a; if (saved.TryGetValue(k, out a)) { r.enabled = a > 0f; saved.Remove(k); } } } }
  if (!any) { if (on) { if (!saved.ContainsKey(c.Pointer)) saved[c.Pointer] = GetAlpha(c, tmp); SetAlpha(c, tmp, 0f); } else { float a; if (saved.TryGetValue(c.Pointer, out a)) { SetAlpha(c, tmp, a <= 0f ? 1f : a); saved.Remove(c.Pointer); } } }
  return any;
 }
 static bool AllHidden(Component c, bool tmp) {
  var crs = c.GetComponentsInChildren<CanvasRenderer>(true); bool any = false;
  foreach (var cr in crs) { any = true; if (cr.GetAlpha() > 0f) return false; }
  if (!any) foreach (var r in c.GetComponentsInChildren<Renderer>(true)) { any = true; if (r.enabled) return false; }
  return any || GetAlpha(c, tmp) <= 0f;
 }
 static bool Shown(Component c) { var b = c.TryCast<Behaviour>(); return c != null && c.gameObject.activeInHierarchy && (b == null || b.enabled); }

 static Camera CameraOf(Component c) {
  var all = c.GetComponentsInParent<Canvas>(true);
  if (all == null || all.Length == 0) return Camera.main;
  var canvas = all[all.Length - 1];
  return canvas.renderMode == RenderMode.ScreenSpaceOverlay ? null : (canvas.worldCamera ?? Camera.main);
 }
 static Vector2 Screen2(Camera cam, Vector3 w) { return cam == null ? new Vector2(w.x, w.y) : (Vector2)cam.WorldToScreenPoint(w); }

 bool Seen(Component c, bool tmp) {
  if (GetAlpha(c, tmp) < 0.02f) return false;
  foreach (var g in c.GetComponentsInParent<CanvasGroup>(true)) { if (g.alpha < 0.02f) return false; if (g.ignoreParentGroups) break; }
  var rt = c.transform.TryCast<RectTransform>(); if (rt == null) return true;
  var corners = new Il2CppInterop.Runtime.InteropTypes.Arrays.Il2CppStructArray<Vector3>(4); rt.GetWorldCorners(corners); var cam = CameraOf(c);
  Vector2 a = Screen2(cam, corners[0]), b = Screen2(cam, corners[2]);
  return Math.Max(a.x, b.x) > 0 && Math.Min(a.x, b.x) < Screen.width && Math.Max(a.y, b.y) > 0 && Math.Min(a.y, b.y) < Screen.height;
 }

 void Scan() {
  var list = new List<KeyValuePair<Component, bool>>();
  foreach (var o in UnityEngine.Object.FindObjectsOfType(Il2CppType.Of<TMP_Text>())) { var c = o.TryCast<Component>(); if (c != null && Shown(c) && Seen(c, true)) list.Add(new KeyValuePair<Component, bool>(c, true)); }
  foreach (var o in UnityEngine.Object.FindObjectsOfType(Il2CppType.Of<UnityEngine.UI.Text>())) { var c = o.TryCast<Component>(); if (c != null && Shown(c) && Seen(c, false)) list.Add(new KeyValuePair<Component, bool>(c, false)); }
  string want = Norm(MeguLitUnityTextIl2Cpp.Instance.Wanted);
  Component best = null; bool bestTmp = false; float bestAt = -1; int bestLen = 0;
  foreach (var kv in list) {
   var c = kv.Key; string t = Norm(TextOf(c, kv.Value)); int id = c.GetInstanceID(); string old;
   if (!seen.TryGetValue(id, out old) || old != t) { seen[id] = t; changedAt[id] = Time.unscaledTime; }
   if (t.Length == 0) continue;
   if (want.Length >= 2) { if ((want.StartsWith(t) && t.Length >= Math.Min(4, want.Length) || t.Contains(want)) && (best == null || t.Length < bestLen)) { best = c; bestTmp = kv.Value; bestLen = t.Length; } continue; }
   int k = Cjk(t); float at; changedAt.TryGetValue(id, out at);
   if (k >= 2 && (at > bestAt || at == bestAt && k > bestLen)) { best = c; bestTmp = kv.Value; bestAt = at; bestLen = k; }
  }
  if (best == null || current == null || best.GetInstanceID() != current.GetInstanceID()) {
   Restore(); current = best; currentIsTmp = bestTmp;
   if (best != null) { var r = best.GetComponent<Renderer>(); MeguLitUnityTextIl2Cpp.Instance.Send("ToMe_UNITY status dialogue " + best.GetIl2CppType().FullName + " canvasRenderers=" + best.GetComponentsInChildren<CanvasRenderer>(true).Length + " renderer=" + (r != null ? r.GetIl2CppType().Name : "-")); }
  }
 }

 void Restore() { if (hiding && current != null) HideSet(current, currentIsTmp, false); hiding = false; saved.Clear(); }

 void LateUpdate() {
  var p = MeguLitUnityTextIl2Cpp.Instance; if (p == null) return;
  try {
   if (Time.unscaledTime >= nextScan) { nextScan = Time.unscaledTime + 0.5f; Scan(); }
   if (current == null || !Shown(current)) { Restore(); current = null; return; }
   bool want = p.HideAsked && p.Connected;
   if (want && !hiding) hiding = true;
   if (!want) Restore();
   // the state left by the game since the last frame decides hidden (a game animating its own colour wins)
   if (p.Connected) Report(hiding && AllHidden(current, currentIsTmp));
   if (hiding) HideSet(current, currentIsTmp, true);
  } catch (Exception e) { p.Log.LogWarning("text " + e.Message); }
 }

 void Report(bool hiddenNow) {
  var all = new List<KeyValuePair<char, float[]>>();
  var cam = CameraOf(current); var tr = current.transform; float sh = Screen.height;
  Action<char, Vector3, Vector3> add = (ch, bl, trc) => {
   Vector2 a = Screen2(cam, tr.TransformPoint(bl)), b = Screen2(cam, tr.TransformPoint(trc));
   float x = Math.Min(a.x, b.x), top = sh - Math.Max(a.y, b.y), w = Math.Abs(b.x - a.x), h = Math.Abs(b.y - a.y);
   if (w <= 0 || h <= 0 || char.IsWhiteSpace(ch) || ch == '　') return;
   all.Add(new KeyValuePair<char, float[]>(ch, new[] { x, top, w, h }));
  };
  if (currentIsTmp) {
   var t = current.Cast<TMP_Text>(); var info = t.textInfo; if (info == null) return; int n = info.characterCount; var arr = info.characterInfo;
   var sizes = new List<float>(); for (int i = 0; i < n && i < arr.Length; i++) if (arr[i].isVisible) sizes.Add(arr[i].pointSize);
   sizes.Sort(); float body = sizes.Count > 0 ? sizes[sizes.Count / 2] : 0f;
   for (int i = 0; i < n && i < arr.Length; i++) { var ci = arr[i]; if (!ci.isVisible) continue; if (body > 0 && ci.pointSize < body * 0.75f) continue; /* ruby */ add(ci.character, ci.bottomLeft, ci.topRight); }
  } else {
   var t = current.Cast<UnityEngine.UI.Text>(); var gen = t.cachedTextGenerator; float ppu = t.pixelsPerUnit; if (ppu <= 0) ppu = 1f;
   var verts = gen.GetVerticesArray(); string s = Keep(t.text ?? "", false); int ci = 0;
   for (int i = 0; i + 3 < verts.Length && ci < s.Length; i += 4, ci++) {
    Vector3 p0 = verts[i].position / ppu, p2 = verts[i + 2].position / ppu;
    add(s[ci], new Vector3(Math.Min(p0.x, p2.x), Math.Min(p0.y, p2.y), 0), new Vector3(Math.Max(p0.x, p2.x), Math.Max(p0.y, p2.y), 0));
   }
  }
  if (all.Count == 0) return;
  var hs = new List<float>(); foreach (var e in all) hs.Add(e.Value[3]); hs.Sort(); float median = hs[hs.Count / 2];
  var rects = new List<float[]>(); var text = new StringBuilder(); float prev = float.NaN;
  foreach (var e in all) {
   var r = e.Value; if (r[3] < median * 0.15f && r[2] < median * 0.15f) continue;
   float mid = r[1] + r[3] / 2; if (!float.IsNaN(prev) && Math.Abs(mid - prev) > median * 0.9f) text.Append('\n');
   prev = mid; text.Append(e.Key); rects.Add(r);
  }
  if (rects.Count == 0) return;
  string flat = text.ToString().Replace("\n", "");
  if (!(lastText.Length > 0 && (flat.StartsWith(lastText) || lastText.StartsWith(flat)))) line++;
  var sb = new StringBuilder();
  foreach (var r in rects) { if (sb.Length > 0) sb.Append(';'); sb.Append(F(r[0])).Append(',').Append(F(r[1])).Append(',').Append(F(r[2])).Append(',').Append(F(r[3])); }
  string key = line + "|" + hiddenNow + "|" + sb;
  if (key == lastKey) return;
  lastKey = key; lastText = flat;
  MeguLitUnityTextIl2Cpp.Instance.Send("ToMe_CHARS engine=unity line=" + line + " hidden=" + (hiddenNow ? 1 : 0) + " sw=" + Screen.width + " sh=" + Screen.height + " vx=0 vy=0 vw=" + Screen.width + " vh=" + Screen.height + " n=" + rects.Count + " rects=" + sb + " text=" + text);
 }
 static string Keep(string s, bool blanks) { var b = new StringBuilder(); foreach (char c in s) if (c != (char)10 && c != (char)13 && (blanks || !char.IsWhiteSpace(c))) b.Append(c); return b.ToString(); }
 static string F(float v) { return Math.Round(v, 1).ToString(System.Globalization.CultureInfo.InvariantCulture); }
 void OnDestroy() { Restore(); }
}
