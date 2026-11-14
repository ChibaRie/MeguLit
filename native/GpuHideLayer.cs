// SPDX-License-Identifier: GPL-3.0-or-later
// Hide layer 4, the "fake GPU" (native/gpuhide, docs/hide-layers.md, owner 2026-11-14: MeguLit draws all game text).
// MeguLitGpu<bit>.dll is loaded into the bound game next to MeguLitFont<bit>.dll. It hooks the game's Direct3D 9 draws and
// GDI blits, learns which textured quads / blits are the glyphs of the dialogue line and where the text area is, and
// then leaves exactly those glyph draws out while a line is armed. No game data is ever changed: a left-out glyph is a
// draw call that is not made. The stream becomes hide-only only after the DLL reports a hit (like E578 / E667).
// C# 5 (the .NET Framework csc), compiled with HookBridge.cs (partial class).
using System;
using System.Diagnostics;
using System.IO;
using System.Threading;
public static partial class HookBridge {
 static readonly object GpuGate=new object();static StreamWriter GpuCtlPipe;static bool GpuSent,GpuLoaded;static string GpuApis="";static string GpuStream="";
 /* Interface for the hide orchestrator (feat/hide-orchestrator). */
 /// <summary>APIs the layer hooked in this game ("d3d9", "gdi"); empty until the DLL reported in.</summary>
 public static string[] GpuCapabilities(){lock(GpuGate){return GpuLoaded&&GpuApis.Length>0?GpuApis.Split(','):new string[0];}}
 /// <summary>Hide the given line of the given stream from now on (60 s, renewed by every call). The DLL learns first and
 /// hides only after it found the line's glyphs; nothing is hidden when it is unsure.</summary>
 public static void GpuArm(string streamId,string line){lock(GpuGate){GpuStream=streamId??"";GpuSent=true;}GpuSend("LINE "+System.Text.RegularExpressions.Regex.Replace(line??"",@"[\r\n  ]+"," "));}
 /// <summary>Stop hiding at once.</summary>
 public static void GpuDisarm(){bool was;lock(GpuGate){was=GpuSent;GpuSent=false;}if(was)GpuSend("OFF");}
 /// <summary>Read-only: learn and report character rectangles, never hide.</summary>
 public static void GpuReadOnly(bool on){GpuSend(on?"MODE read":"MODE hide");}
 /// <summary>First hidden draw of a line: (stream, line number, glyph quads left out, characters of the line).</summary>
 public static event Action<string,int,int,int> GpuHit;
 static void GpuSend(string line){lock(GpuGate){if(GpuCtlPipe==null)return;try{GpuCtlPipe.WriteLine(line);}catch{GpuCtlPipe=null;}}}
 // The same streams the glyph hide (E667) serves: the selected stream without write-back, with replacement on or probing.
 static bool GpuWanted(){lock(Gate){Candidate c;return Enabled&&(ReplacementEnabled||ProbeWanted)&&Selected!=""&&Candidates.TryGetValue(Selected,out c)&&c.gdiProbe;}}
 static void GpuLine(string text){if(GpuWanted()){string s;lock(Gate){s=Selected;}GpuArm(s,text);}else GpuDisarm();}
 static void GpuReport(string s){
  if(s.StartsWith("ToMe_CHARS ",StringComparison.Ordinal)){Emit(new{type="hookChars",line=s});return;}
  if(!s.StartsWith("ToMe_GPUHIDE ",StringComparison.Ordinal))return;s=s.Substring(13);Diagnostic("gpu hide "+s);
  var ready=System.Text.RegularExpressions.Regex.Match(s,@"^ready version=(\d{1,4}) apis=([a-z0-9,]{1,64})");if(ready.Success){lock(GpuGate){GpuLoaded=GpuCanaryOff()=="";GpuApis=ready.Groups[2].Value;}Emit(new{type="hookGpuHide",state="ready",version=Int32.Parse(ready.Groups[1].Value),apis=ready.Groups[2].Value});return;}
  var learn=System.Text.RegularExpressions.Regex.Match(s,@"^learn seq=(\d+) area=(-?\d+),(-?\d+),(\d+),(\d+) atlas=(\d+)x(\d+) glyphs=(\d+) chars=(\d+)");
  if(learn.Success){Emit(new{type="hookGpuHide",state="learn",line=Int32.Parse(learn.Groups[1].Value),area=new[]{Int32.Parse(learn.Groups[2].Value),Int32.Parse(learn.Groups[3].Value),Int32.Parse(learn.Groups[4].Value),Int32.Parse(learn.Groups[5].Value)},glyphs=Int32.Parse(learn.Groups[8].Value),chars=Int32.Parse(learn.Groups[9].Value)});return;}
  var hit=System.Text.RegularExpressions.Regex.Match(s,@"^hit seq=(\d+) quads=(\d+) chars=(\d+)");
  if(hit.Success){int seq=Int32.Parse(hit.Groups[1].Value),quads=Int32.Parse(hit.Groups[2].Value),chars=Int32.Parse(hit.Groups[3].Value);string stream;lock(GpuGate){stream=GpuStream;}
   bool fresh=false;lock(Gate){Candidate c;if(Selected!=""&&Selected==stream&&Candidates.TryGetValue(Selected,out c)&&c.gdiProbe&&!c.embed)fresh=true;}
   if(fresh){GdiHideHit("gpu "+s.Substring(4));Status("通用绘制层隐藏已生效：游戏原文由 MeguLit 接管显示");}
   Emit(new{type="hookGpuHide",state="hit",line=seq,quads=quads,chars=chars});var h=GpuHit;if(h!=null)try{h(stream,seq,quads,chars);}catch{}return;}
 }
 /* Crash canary (owner 2026-11-14: layer 4 must never crash a game). Per game build (data/gpu-hide/<exe>-<size>.json, the
    key of the stream memory): armed while the DLL is loaded into a running game; the bridge waits for the game to end.
    An exit by an exception (NTSTATUS error codes 0xC0000000-0xCFFFFFFF: access violation, stack overflow, ...; not 0xFFFFFFFF = a forced kill) turns the layer off for that
    game ("off", with the reason); any other exit clears the arm. Turning it on again is the user's call (GpuCanaryReset). */
 [System.Runtime.InteropServices.DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr h,uint ms);
 [System.Runtime.InteropServices.DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr h,out uint code);
 static string GpuCanaryFile(){string m=MemoryPath();if(m=="")return "";return Path.Combine(Path.GetDirectoryName(Path.GetDirectoryName(m)),"gpu-hide",Path.GetFileName(m));}
 static System.Collections.Generic.Dictionary<string,object> GpuCanaryRead(string f){try{if(f!=""&&File.Exists(f))return Json.Deserialize<System.Collections.Generic.Dictionary<string,object>>(File.ReadAllText(f));}catch{}return new System.Collections.Generic.Dictionary<string,object>();}
 static void GpuCanaryWrite(string f,System.Collections.Generic.Dictionary<string,object> d){try{if(f=="")return;Directory.CreateDirectory(Path.GetDirectoryName(f));File.WriteAllText(f+".tmp",Json.Serialize(d));if(File.Exists(f))File.Delete(f);File.Move(f+".tmp",f);}catch{}}
 /// <summary>Why the layer is off for the bound game ("" = allowed).</summary>
 public static string GpuCanaryOff(){return GpuCanaryOffFile(GpuCanaryFile());}
 /// <summary>The user turns the layer on again for the bound game.</summary>
 public static void GpuCanaryReset(){string f=GpuCanaryFile();if(f!=""&&File.Exists(f))try{File.Delete(f);}catch{}}
 static string GpuCanaryOffFile(string f){var d=GpuCanaryRead(f);object v;return d.TryGetValue("off",out v)&&Convert.ToBoolean(v)?(d.ContainsKey("reason")?Convert.ToString(d["reason"]):"off"):"";}
 // Arms the file for a run (false = the layer is off for this game). Pure file logic, self-tested.
 static bool GpuCanaryArmFile(string f,long pid){if(f=="")return true;var d=GpuCanaryRead(f);object v;if(d.TryGetValue("off",out v)&&Convert.ToBoolean(v))return false;
  if(d.TryGetValue("armed",out v)&&Convert.ToBoolean(v))Diagnostic("gpu hide canary: the previous run was not seen to its end (bridge stopped first); keeping the layer on");
  d["armed"]=true;d["pid"]=pid;d["at"]=DateTime.UtcNow.ToString("o");GpuCanaryWrite(f,d);return true;}
 // The game ended with this exit code: an exception code turns the layer off for the game, anything else clears the arm.
 static void GpuCanaryExitFile(string f,uint code){if(f=="")return;var e=GpuCanaryRead(f);e["armed"]=false;e["exit"]=(long)code;
  if(code>=0xC0000000u&&code<=0xCFFFFFFFu){e["off"]=true;e["reason"]="game exited with exception 0x"+code.ToString("X8")+" while layer 4 was loaded ("+DateTime.UtcNow.ToString("o")+")";Diagnostic("gpu hide canary: "+e["reason"]+"; layer 4 is off for this game from now on");}
  GpuCanaryWrite(f,e);}
 // Returns false when the layer must not load into this game.
 static bool GpuCanaryArm(){string f=GpuCanaryFile();if(f=="")return true;
  if(!GpuCanaryArmFile(f,(long)Pid)){string why=GpuCanaryOffFile(f);Diagnostic("gpu hide off for this game (canary): "+why);Emit(new{type="hookGpuHide",state="off",reason=why});return false;}
  new Thread(()=>{IntPtr h=OpenProcess(0x00100000|0x1000,false,Pid);if(h==IntPtr.Zero)return;try{WaitForSingleObject(h,0xFFFFFFFF);uint code;if(GetExitCodeProcess(h,out code))GpuCanaryExitFile(f,code);}finally{CloseHandle(h);}}){IsBackground=true}.Start();
  return true;}
 /// <summary>HookBridge --self-test: arm, crash, refuse, reset, clean exit.</summary>
 public static bool GpuCanarySelfTest(){string dir=Path.Combine(Path.GetTempPath(),"megulit-gpu-canary-"+Guid.NewGuid().ToString("N"));string f=Path.Combine(dir,"game.exe-1.json");
  try{if(!GpuCanaryArmFile(f,1)||GpuCanaryOffFile(f)!="")return false;GpuCanaryExitFile(f,0);if(GpuCanaryOffFile(f)!=""||!GpuCanaryArmFile(f,2))return false;
   GpuCanaryExitFile(f,1);if(GpuCanaryOffFile(f)!=""||!GpuCanaryArmFile(f,2))return false; /* an ordinary non-zero exit is not a crash */
   GpuCanaryExitFile(f,0xFFFFFFFFu);if(GpuCanaryOffFile(f)!="")return false; /* nor a forced kill (TerminateProcess -1) */
   if(!GpuCanaryArmFile(f,3))return false;GpuCanaryExitFile(f,0xC0000005u);if(GpuCanaryOffFile(f).IndexOf("0xC0000005",StringComparison.Ordinal)<0||GpuCanaryArmFile(f,4))return false;
   File.Delete(f);return GpuCanaryArmFile(f,5);}catch{return false;}finally{try{Directory.Delete(dir,true);}catch{}}}
 /* Text marks (docs/text-architecture.md, "Marks"; owner 2026-11-14): the game draws its own line as a row of 「・」 and
    the capture compositor places MeguLit's text on the marks. Off unless {"type":"textMarks","on":true} arrives on stdin
    or MEGULIT_TEXT_MARKS=1 is in HookBridge's environment. Write-back streams get the marks from OnEmbed
    (EmbedTextPolicy.Mark: same count, constructs kept); per-character hooks that read the character from an argument
    (BRUNS push_back) mark it in the hook DLL while Local\MeguLitMarks-<pid> is set (MeguLitMarks.h). Every marked line is
    reported as {"type":"hookTextMarks","state":"line",...}; the first mark the hook DLL writes per line confirms a
    per-character stream (state "hit") and makes it hide-only, like the GDI hide. The crash canary (GpuCanary*) covers it. */
 static bool MarksMode; static IntPtr MarksEvent;
 [System.Runtime.InteropServices.DllImport("kernel32.dll",CharSet=System.Runtime.InteropServices.CharSet.Unicode)] static extern IntPtr CreateEventW(IntPtr sa,bool manual,bool initial,string name);
 [System.Runtime.InteropServices.DllImport("kernel32.dll")] static extern bool SetEvent(IntPtr h);
 [System.Runtime.InteropServices.DllImport("kernel32.dll")] static extern bool ResetEvent(IntPtr h);
 public static void SetMarks(bool on){
  if(on&&GpuCanaryOff()!=""){Diagnostic("text marks refused: crash canary ("+GpuCanaryOff()+")");on=false;}
  MarksMode=on;if(MarksEvent==IntPtr.Zero)MarksEvent=CreateEventW(IntPtr.Zero,true,false,"Local\\MeguLitMarks-"+Pid);
  if(MarksEvent!=IntPtr.Zero){if(on)SetEvent(MarksEvent);else ResetEvent(MarksEvent);}
  Diagnostic("text marks "+(on?"on":"off"));Emit(new{type="hookTextMarks",state=on?"on":"off",mark="middle-dot"});}
 static void MarksLine(string path,string text,string marked){int n=0;foreach(char c in marked)if(c=='\u30FB'||c=='\uFF65')n++;
  Emit(new{type="hookTextMarks",state="line",path=path,text=text,marks=n,mark="middle-dot"});}
 static void MarksHit(string info){bool fresh=false;lock(Gate){Candidate c;if(Selected!=""&&Candidates.TryGetValue(Selected,out c)&&c.gdiProbe&&!c.embed)fresh=true;}
  if(fresh){GdiHideHit("marks "+info);Status("文字标记已生效：游戏把对白画成「・」，由 MeguLit 接管显示");}
  Emit(new{type="hookTextMarks",state="hit",path="char",mark="middle-dot"});}
 static void GpuHide(string bit,string loader,string[] args){try{string dll=Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"MeguLitGpu"+bit+".dll");if(!File.Exists(dll)){Diagnostic("gpu hide unavailable: "+Path.GetFileName(dll)+" missing");return;}
  if(Environment.GetEnvironmentVariable("MEGULIT_TEXT_MARKS")=="1")SetMarks(true);
  if(!GpuCanaryArm())return;
  new Thread(()=>{while(!Quit){try{using(var pipe=new System.IO.Pipes.NamedPipeServerStream("MeguLitGpu-"+Pid,System.IO.Pipes.PipeDirection.In,1)){pipe.WaitForConnection();using(var reader=new StreamReader(pipe,new System.Text.UTF8Encoding(false))){string line;while((line=reader.ReadLine())!=null)GpuReport(line);}}}catch(Exception e){Diagnostic("gpu pipe "+e.Message);Thread.Sleep(1000);}}}){IsBackground=true}.Start();
  new Thread(()=>{while(!Quit){try{using(var pipe=new System.IO.Pipes.NamedPipeServerStream("MeguLitGpuCtl-"+Pid,System.IO.Pipes.PipeDirection.Out,1)){pipe.WaitForConnection();var w=new StreamWriter(pipe,new System.Text.UTF8Encoding(false)){AutoFlush=true,NewLine="\n"};lock(GpuGate){GpuCtlPipe=w;GpuSent=false;}Diagnostic("gpu hide connected");while(!Quit){lock(GpuGate){if(GpuCtlPipe!=w)break;}Thread.Sleep(500);}}}catch(Exception e){lock(GpuGate){GpuCtlPipe=null;}Diagnostic("gpu control "+e.Message);Thread.Sleep(1000);}}}){IsBackground=true}.Start();
  var start=new ProcessStartInfo(loader,Pid+" "+args[1]+" \""+args[2]+"\" "+args[3]+" \""+dll+"\""){UseShellExecute=false,CreateNoWindow=true,RedirectStandardError=true};using(var child=Process.Start(start)){if(!child.WaitForExit(12000)){Diagnostic("gpu hide load timed out");return;}Diagnostic(child.ExitCode==0?"gpu hide loaded":"gpu hide failed: "+child.StandardError.ReadToEnd().Trim());}}catch(Exception e){Diagnostic("gpu hide skipped: "+e.Message);}}
}
