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
 static bool GpuWanted(){lock(Gate){Candidate c;return Enabled&&(ReplacementEnabled||ProbeWanted)&&Selected!=""&&Candidates.TryGetValue(Selected,out c)&&(c.gdiProbe||GlyphMode=="dot"&&GlyphAll);}} /* text-arch: in ①'s dot mode (compositor) the GDI probe is never switched on, the stream is still the dialogue */
 static void GpuLine(string text){if(GpuWanted()){string s;lock(Gate){s=Selected;}GpuArm(s,text);}else GpuDisarm();}
 static void GpuReport(string s){
  if(s.StartsWith("ToMe_CHARS ",StringComparison.Ordinal)){Emit(new{type="hookChars",line=s});return;}
  if(!s.StartsWith("ToMe_GPUHIDE ",StringComparison.Ordinal))return;s=s.Substring(13);Diagnostic("gpu hide "+s);
  var ready=System.Text.RegularExpressions.Regex.Match(s,@"^ready version=(\d{1,4}) apis=([a-z0-9,]{1,64})");if(ready.Success){lock(GpuGate){GpuLoaded=true;GpuApis=ready.Groups[2].Value;}Emit(new{type="hookGpuHide",state="ready",version=Int32.Parse(ready.Groups[1].Value),apis=ready.Groups[2].Value});return;}
  var learn=System.Text.RegularExpressions.Regex.Match(s,@"^learn seq=(\d+) area=(-?\d+),(-?\d+),(\d+),(\d+) atlas=(\d+)x(\d+) glyphs=(\d+) chars=(\d+)");
  if(learn.Success){Emit(new{type="hookGpuHide",state="learn",line=Int32.Parse(learn.Groups[1].Value),area=new[]{Int32.Parse(learn.Groups[2].Value),Int32.Parse(learn.Groups[3].Value),Int32.Parse(learn.Groups[4].Value),Int32.Parse(learn.Groups[5].Value)},glyphs=Int32.Parse(learn.Groups[8].Value),chars=Int32.Parse(learn.Groups[9].Value)});return;}
  var hit=System.Text.RegularExpressions.Regex.Match(s,@"^hit seq=(\d+) quads=(\d+) chars=(\d+)");
  if(hit.Success){int seq=Int32.Parse(hit.Groups[1].Value),quads=Int32.Parse(hit.Groups[2].Value),chars=Int32.Parse(hit.Groups[3].Value);string stream;lock(GpuGate){stream=GpuStream;}
   bool fresh=false;lock(Gate){Candidate c;if(Selected!=""&&Selected==stream&&Candidates.TryGetValue(Selected,out c)&&c.gdiProbe&&!c.embed)fresh=true;}
   if(fresh){GdiHideHit("gpu "+s.Substring(4));Status("通用绘制层隐藏已生效：游戏原文由 MeguLit 接管显示");}
   Emit(new{type="hookGpuHide",state="hit",line=seq,quads=quads,chars=chars});var h=GpuHit;if(h!=null)try{h(stream,seq,quads,chars);}catch{}return;}
 }
 static void GpuHide(string bit,string loader,string[] args){try{string dll=Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"MeguLitGpu"+bit+".dll");if(!File.Exists(dll)){Diagnostic("gpu hide unavailable: "+Path.GetFileName(dll)+" missing");return;}
  new Thread(()=>{while(!Quit){try{using(var pipe=new System.IO.Pipes.NamedPipeServerStream("MeguLitGpu-"+Pid,System.IO.Pipes.PipeDirection.In,1)){pipe.WaitForConnection();using(var reader=new StreamReader(pipe,new System.Text.UTF8Encoding(false))){string line;while((line=reader.ReadLine())!=null)GpuReport(line);}}}catch(Exception e){Diagnostic("gpu pipe "+e.Message);Thread.Sleep(1000);}}}){IsBackground=true}.Start();
  new Thread(()=>{while(!Quit){try{using(var pipe=new System.IO.Pipes.NamedPipeServerStream("MeguLitGpuCtl-"+Pid,System.IO.Pipes.PipeDirection.Out,1)){pipe.WaitForConnection();var w=new StreamWriter(pipe,new System.Text.UTF8Encoding(false)){AutoFlush=true,NewLine="\n"};lock(GpuGate){GpuCtlPipe=w;GpuSent=false;}Diagnostic("gpu hide connected");while(!Quit){lock(GpuGate){if(GpuCtlPipe!=w)break;}Thread.Sleep(500);}}}catch(Exception e){lock(GpuGate){GpuCtlPipe=null;}Diagnostic("gpu control "+e.Message);Thread.Sleep(1000);}}}){IsBackground=true}.Start();
  var start=new ProcessStartInfo(loader,Pid+" "+args[1]+" \""+args[2]+"\" "+args[3]+" \""+dll+"\""){UseShellExecute=false,CreateNoWindow=true,RedirectStandardError=true};using(var child=Process.Start(start)){if(!child.WaitForExit(12000)){Diagnostic("gpu hide load timed out");return;}Diagnostic(child.ExitCode==0?"gpu hide loaded":"gpu hide failed: "+child.StandardError.ReadToEnd().Trim());}}catch(Exception e){Diagnostic("gpu hide skipped: "+e.Message);}}
}
