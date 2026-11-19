// SPDX-License-Identifier: GPL-3.0-or-later
// One decision for the reading layer's place and for when the screen probes may be believed (user, 2026-11-19: Alt+T kept
// switching the subtitles and the game's text box, after more than twenty fixes).
// Before, five places in GalWindowBridge.Tick each read GetForegroundWindow() for themselves and each applied its own rule:
// the tick sank the layer out of the topmost band when "the game is not in front", the foreground hook let it float when
// "MeguLit's own layer is in front", the visibility test hid it when "nothing of ours is in front". Closing the Alt+T menu
// hands the keyboard from the layer back to the game: for a few ticks the foreground is the layer, then nothing, then the
// game. Each reader caught a different moment, the layer was sunk or hidden, the game was activated above it, and
// HookBridge (which only looks at the z-order) gave the text back to the game: the menu key "switched the text".
// Rules, all in Decide():
//  - the foreground is classified once per tick; "no foreground window" (an activation in flight) is never a fact of its
//    own: the last known front is kept (for at most HoldMs)
//  - the game and MeguLit's own layer in front are the same context: handing the keyboard between them moves nothing
//  - only a foreign program in front (or the game minimised) takes the layer out of the topmost band
//  - the screen probes (wait marker, text-window and scene compare, game UI) are believed only after the game has been
//    in front, with no menu and no word card, for SettleMs without a break (Settled()); a click or key is a fact and is
//    reported at once
// No window calls in here: --layer-policy-self-test replays recorded and random sequences. C# 5 (.NET Framework csc).
using System;

internal static class ReaderLayerPolicy {
    public const int Game=0,OwnLayer=1,OwnHome=2,Foreign=3,None=4;
    public static int SettleMs=700,HoldMs=1000;
    public struct State{public int Front;public bool Float,Context,Pinned;}
    static int Anchor=Foreign;static long NoneSince=-1,SettledSince=-1;

    public static void Reset(){Anchor=Foreign;NoneSince=-1;SettledSince=-1;}

    /// <summary>What is in front. gameTree: the foreground window belongs to the game's window tree; gameProcess: to its
    /// process or its IME; ownLayer: it is the reading layer; ownProcess: another window of MeguLit.</summary>
    public static int Classify(bool hasForeground,bool gameTree,bool gameProcess,bool ownLayer,bool ownProcess){
        if(!hasForeground)return None;
        if(ownLayer)return OwnLayer;
        if(gameTree||gameProcess)return Game;
        if(ownProcess)return OwnHome;
        return Foreign;
    }

    /// <summary>front: Classify() of this tick. homeCounts: another MeguLit window in front keeps the layer shown (the
    /// main window hosts it). Float: the layer may be topmost above the game. Context: the layer may be shown at all
    /// (cover, dialogue and menu still decide). Pinned: the open menu holds it above the game.</summary>
    public static State Decide(int front,bool menu,bool menuReady,bool homeCounts,bool gameIconic,long nowMs){
        if(front==None){
            if(NoneSince<0)NoneSince=nowMs;
            if(nowMs-NoneSince>=HoldMs)Anchor=Foreign;
        }else{NoneSince=-1;Anchor=front;}
        State s=new State();s.Front=Anchor;
        bool game=Anchor==Game,own=Anchor==OwnLayer,home=Anchor==OwnHome;
        s.Pinned=menu&&menuReady&&(game||own||home);
        s.Float=!gameIconic&&(game||own||s.Pinned);
        s.Context=game||own||home&&homeCounts||s.Pinned;
        return s;
    }

    /// <summary>May the screen probes be believed? raw: the game is in front, no menu, no word card, cover on, not
    /// minimised. True only after raw has held for SettleMs without a break.</summary>
    public static bool Settled(bool raw,long nowMs){
        if(!raw){SettledSince=-1;return false;}
        if(SettledSince<0)SettledSince=nowMs;
        return nowMs-SettledSince>=SettleMs;
    }
    public static void Unsettle(){SettledSince=-1;}

    /* What the tick did before (kept for the self-test only: the recorded sequence must fail on it). */
    static bool LegacyFloat(int front,bool menu,bool menuReady){return front==Game||menu&&menuReady&&(front==Game||front==OwnLayer||front==OwnHome);}
    static bool LegacyContext(int front,bool menu,bool menuReady){return front==Game||front==OwnLayer||menu&&menuReady&&front==OwnHome;}

    /// <summary>"" when every rule holds, else what failed.</summary>
    public static string SelfTest(){
        int keepSettle=SettleMs,keepHold=HoldMs;
        try{
            SettleMs=700;HoldMs=1000;
            /* 1. recorded (千恋＊万花, 2026-11-19 15:00:39.80 local): menu open with the keyboard on the layer, Alt+T closes
                  it, the foreground goes layer -> nothing -> game inside 60 ms. The layer must float and stay shown at
                  every step; the old rules sank it at the first step and hid it at the second. */
            int[] fronts={Game,Game,OwnLayer,OwnLayer,OwnLayer,None,Game,Game};
            bool[] menus={false,true,true,true,false,false,false,false};
            Reset();long t=0;bool legacyBroke=false;
            for(int i=0;i<fronts.Length;i++,t+=16){
                State s=Decide(fronts[i],menus[i],menus[i],false,false,t);
                if(!s.Float)return "recorded close: layer left the topmost band at step "+i;
                if(!s.Context)return "recorded close: layer hidden at step "+i;
                if(!LegacyFloat(fronts[i],menus[i],menus[i])||!LegacyContext(fronts[i],menus[i],menus[i]))legacyBroke=true;
            }
            if(!legacyBroke)return "recorded close: the old rules do not fail on it (the test proves nothing)";
            /* 2. any order of menu open / close, keyboard on the layer or the game, activations in flight: nothing moves */
            var random=new Random(20261119);
            for(int run=0;run<2000;run++){
                Reset();t=0;Decide(Game,false,false,false,false,t);bool menu=false;
                for(int step=0;step<60;step++){
                    t+=random.Next(1,90);int roll=random.Next(5);
                    int front=roll==0?None:roll<3?Game:OwnLayer;
                    if(random.Next(4)==0)menu=!menu;
                    bool ready=menu&&random.Next(3)!=0;
                    State s=Decide(front,menu,ready,random.Next(2)==0,false,t);
                    if(!s.Float||!s.Context)return "random run "+run+" step "+step+": front "+front+" menu "+menu+" float "+s.Float+" context "+s.Context;
                }
            }
            /* 3. a foreign program in front sinks the layer at once, also with the menu open; back on the game it floats again */
            Reset();Decide(Game,false,false,false,false,0);
            State foreign=Decide(Foreign,true,true,false,false,16);
            if(foreign.Float||foreign.Context)return "foreign program in front: layer kept floating or shown";
            if(!Decide(Game,false,false,false,false,32).Float)return "back on the game: layer not floating";
            /* 4. the game minimised never floats; no foreground for longer than HoldMs counts as foreign */
            if(Decide(Game,false,false,false,true,48).Float)return "minimised game: layer floating";
            Reset();Decide(Game,false,false,false,false,0);
            if(!Decide(None,false,false,false,false,500).Float)return "no foreground for 0.5 s: layer sunk";
            Decide(None,false,false,false,false,600);
            if(Decide(None,false,false,false,false,1600).Float)return "no foreground for over 1 s: layer still floating";
            /* 5. another MeguLit window in front: shown only where the main window hosts the layer, pinned by an open menu */
            Reset();
            if(Decide(OwnHome,false,false,false,false,0).Context)return "MeguLit window in front without hosting: layer shown";
            if(!Decide(OwnHome,false,false,true,false,16).Context||Decide(OwnHome,false,false,true,false,16).Float)return "hosting MeguLit window in front: wrong";
            if(!Decide(OwnHome,true,true,false,false,32).Float)return "menu open under a MeguLit window: not pinned";
            /* 6. probes: silent through every menu / focus change and for SettleMs after the game is back */
            Unsettle();
            if(Settled(true,0)||Settled(true,699))return "probes believed before the settle time";
            if(!Settled(true,700))return "probes never believed";
            if(Settled(false,800))return "probes believed with the menu open";
            if(Settled(true,900)||Settled(true,1500))return "probes believed right after the menu closed";
            if(!Settled(true,1600))return "probes not believed after settling again";
            for(int run=0;run<500;run++){
                Unsettle();t=0;long rawSince=-1;
                for(int step=0;step<80;step++){
                    t+=random.Next(1,200);bool raw=random.Next(4)!=0;
                    if(!raw)rawSince=-1;else if(rawSince<0)rawSince=t;
                    bool ok=Settled(raw,t);
                    if(ok&&(rawSince<0||t-rawSince<SettleMs))return "probes believed "+(rawSince<0?-1:t-rawSince)+" ms after a context change";
                }
            }
            if(Classify(false,true,true,true,true)!=None||Classify(true,true,false,true,true)!=OwnLayer||Classify(true,false,true,false,true)!=Game||Classify(true,false,false,false,true)!=OwnHome||Classify(true,false,false,false,false)!=Foreign)return "classify";
            return "";
        }finally{SettleMs=keepSettle;HoldMs=keepHold;Reset();}
    }
}
