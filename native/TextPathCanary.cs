// SPDX-License-Identifier: GPL-3.0-or-later
// Text architecture ③ crash canary (docs/text-architecture.md; same file and rules as core/text-paths.cjs Canary).
// data/text-paths/<exe name>-<exe size>.json: { armed: { <path>: {at, alive} }, off: { <path>: {at, reason} } }.
// A path (krkr, renpy, web, unity) is armed the moment it first makes the game draw its own text invisible, kept alive
// while the game runs, and cleared after 20 s or a clean exit (code 0). Found still armed at the next start, or the
// game exiting with another code while armed: the path is off for this game from then on. Times are Unix ms.
using System;
using System.Collections.Generic;
using System.IO;
using System.Web.Script.Serialization;

static class TextPathCanary {
 public const long SafeAfter=20000;
 static readonly object Lock=new object();
 static readonly JavaScriptSerializer Json=new JavaScriptSerializer();
 static string File_="";
 static readonly Dictionary<string,long> LastAlive=new Dictionary<string,long>();
 public static Func<long> Now=()=>DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

 public static void Init(string file){lock(Lock){File_=file??"";}Settle();}
 static Dictionary<string,object> Read(){try{if(File_!=""&&File.Exists(File_))return Json.Deserialize<Dictionary<string,object>>(File.ReadAllText(File_))??new Dictionary<string,object>();}catch{}return new Dictionary<string,object>();}
 static void Write(Dictionary<string,object> d){if(File_=="")return;try{Directory.CreateDirectory(Path.GetDirectoryName(File_));string t=File_+".bridge.tmp";File.WriteAllText(t,Json.Serialize(d));if(File.Exists(File_))File.Replace(t,File_,null);else File.Move(t,File_);}catch{}}
 static Dictionary<string,object> Part(Dictionary<string,object> d,string name){object v;var p=d.TryGetValue(name,out v)?v as Dictionary<string,object>:null;if(p==null){p=new Dictionary<string,object>();d[name]=p;}return p;}
 static long Num(Dictionary<string,object> e,string k){object v;return e!=null&&e.TryGetValue(k,out v)?Convert.ToInt64(v):0;}
 static void Off(Dictionary<string,object> d,string path,string reason){Part(d,"off")[path]=new Dictionary<string,object>{{"at",Now()},{"reason",reason}};}

 // At start: whatever the last run left armed died with it.
 public static void Settle(){lock(Lock){var d=Read();var armed=Part(d,"armed");if(armed.Count==0)return;
  foreach(var k in new List<string>(armed.Keys)){var a=armed[k] as Dictionary<string,object>;long at=Num(a,"at"),alive=Math.Max(at,Num(a,"alive"));if(alive-at<SafeAfter)Off(d,k,"game ended "+((alive-at)/1000)+" s after "+k+" was switched on");armed.Remove(k);}
  Write(d);}}
 public static bool Allowed(string path){lock(Lock){object v;var off=Read().TryGetValue("off",out v)?v as Dictionary<string,object>:null;return off==null||!off.ContainsKey(path);}}
 public static string Why(string path){lock(Lock){object v;var off=Read().TryGetValue("off",out v)?v as Dictionary<string,object>:null;object e;return off!=null&&off.TryGetValue(path,out e)&&e is Dictionary<string,object>?Convert.ToString(((Dictionary<string,object>)e)["reason"]):"";}}
 public static void Arm(string path){lock(Lock){var d=Read();var armed=Part(d,"armed");if(armed.ContainsKey(path))return;long t=Now();armed[path]=new Dictionary<string,object>{{"at",t},{"alive",t}};LastAlive[path]=t;Write(d);}}
 // Called often; writes at most every 2 s, and drops the arm once the game has run 20 s with the path.
 public static void Alive(string path){lock(Lock){long t=Now(),last;if(LastAlive.TryGetValue(path,out last)&&t-last<2000)return;LastAlive[path]=t;var d=Read();var armed=Part(d,"armed");object v;if(!armed.TryGetValue(path,out v))return;var a=v as Dictionary<string,object>;if(a==null)return;a["alive"]=t;if(t-Num(a,"at")>=SafeAfter)armed.Remove(path);Write(d);}}
 public static void Exited(int code){lock(Lock){var d=Read();var armed=Part(d,"armed");if(armed.Count==0)return;foreach(var k in new List<string>(armed.Keys)){if(code!=0){var a=armed[k] as Dictionary<string,object>;Off(d,k,"game exited with 0x"+code.ToString("x8")+" "+((Now()-Num(a,"at"))/1000)+" s after "+k+" was switched on");}armed.Remove(k);}Write(d);}}

 public static bool SelfTest(){
  string dir=Path.Combine(Path.GetTempPath(),"megulit-canary-"+Guid.NewGuid().ToString("N"));long now=1000000;var keep=Now;Now=()=>now;
  try{string f=Path.Combine(dir,"g.json");
   Init(f);if(!Allowed("renpy"))return false;
   Arm("renpy");now+=5000;Alive("renpy");Init(f);if(Allowed("renpy"))return false;                // died 5 s in: off next start
   if(!Allowed("krkr"))return false;Arm("krkr");now+=21000;Alive("krkr");Init(f);if(!Allowed("krkr"))return false; // ran 21 s: stays on
   Arm("krkr");Exited(0);Init(f);if(!Allowed("krkr"))return false;                                   // clean quit right away: stays on
   Arm("krkr");Exited(unchecked((int)0xC0000005));if(Allowed("krkr")||Why("krkr").IndexOf("c0000005",StringComparison.Ordinal)<0)return false;
   return true;
  }finally{Now=keep;lock(Lock){File_="";LastAlive.Clear();}try{Directory.Delete(dir,true);}catch{}}
 }
}
