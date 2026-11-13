# SPDX-License-Identifier: GPL-3.0-or-later
# E301 Ren'Py sentence positions (user 2026-11-10: every engine should place each sentence of a full-screen page where
# the game drew it, with the game's own line breaks, as ISLAND and KiriKiri do). MeguLitRenpy32/64.dll runs this file
# inside the game's own Python (native/renpytext/RenpyText.cpp) every two seconds; the first run that finds Ren'Py
# installs two wrappers, later runs only re-check them (a script reload replaces modules):
#   renpy.character.display_say (and renpy.exports.display_say): a new sentence, NVL when shown by nvl_show_core;
#   renpy.display.render.render_screen: after each frame is laid out, the sentence's Text is looked up in the render
#   tree (Render.render_of), its glyphs are read from its Layout and placed on the virtual screen (config.screen_width
#   x screen_height) through the children offsets and reverse matrices, the way Ren'Py's own focus code does.
# Each sentence is reported once, begin and end in the same frame (the layout already holds every glyph, slow text too):
#   ToMe_RENPY begin|end line=N same=0|1 nvl=0|1 x0= y0= x1= y1= size= sw= sh= n= [text=...]
# same=0 for the first entry of an NVL page (nvl_list holds only it). ADV sentences send one begin with nvl=0, so
# MeguLit keeps its usual single-line reader there.
# Text architecture 3 (docs/text-architecture.md, 2026-11-14: MeguLit draws all game text itself): every located sentence,
# ADV and NVL, also sends one record with the box of each drawn character (core/text-paths.cjs):
#   ToMe_CHARS engine=renpy line=N hidden=0|1 sw= sh= vx= vy= vw= vh= n= rects=x,y,w,h;... text=...
# While HookBridge asks for it (event Local\MeguLitRenpyHide-<pid> set, and the pipe to it connected) the say Text's own
# Render is drawn at alpha 0: Ren'Py lays out, wraps and waits as always, only the pixels of that one Text are left out.
# hidden=1 is sent only after a frame really rendered the sentence that way; when the event is reset the next frame
# draws the text again. Nothing in the game's store, saves or files changes. Lines go to \\.\pipe\MeguLitRenpy-<pid> from a writer thread;
# nothing in the game's store or saves is touched, and every wrapper falls back to the game's own function.
def _megulit_renpy_main():
    import sys
    core = getattr(sys, '_megulit_renpy', None)
    if core is not None:
        try:
            core.refresh()
        except Exception:
            pass
        return
    if 'renpy' not in sys.modules:
        return
    import os, re, threading, time
    try:
        unichr_ = unichr  # noqa: F821 (Python 2, Ren'Py 7 and older)
        text_types = (str, unicode)  # noqa: F821
    except NameError:
        unichr_ = chr
        text_types = (str,)
    skip = set([0xFEFF, 0xFFFC, 0x200B, 0x200C, 0x200D])
    ruby_tags = re.compile(r'\{(rt|art)\}.*?\{/\1\}')
    blank = re.compile(u'[ \u3000\r\n\t]')

    class Core(object):
        def __init__(self):
            self.line = 0
            self.cur = None
            self.status = ''
            self.queue = []
            self.lock = threading.Lock()
            self.wake = threading.Event()
            self.sink = getattr(sys, '_megulit_renpy_sink', None)
            self.pipe_name = '\\\\.\\pipe\\MeguLitRenpy-%d' % os.getpid()
            self.connected = self.sink is not None
            self.hide_event = None
            self.hide_tried = 0.0
            self.page, self.want, self.hidden = [], False, []
            if self.sink is None:
                t = threading.Thread(target=self.writer, name='MeguLitRenpy')
                t.daemon = True
                t.start()

        # ---- output ---------------------------------------------------------------------------------------------------
        def send(self, s):
            s = s.replace('\r', ' ').replace('\n', '\x1f')
            if self.sink is not None:
                self.sink(s)
                return
            with self.lock:
                if len(self.queue) >= 512:
                    self.queue.pop(0)
                self.queue.append(s)
            self.wake.set()

        def writer(self):
            pipe = None
            while True:
                self.wake.wait(5)
                self.wake.clear()
                with self.lock:
                    items, self.queue = self.queue, []
                if not items:
                    continue
                if pipe is None:
                    try:
                        pipe = open(self.pipe_name, 'wb', 0)
                        items.insert(0, 'ToMe_RENPY status ' + self.status)
                        self.connected = True
                    except Exception:
                        pipe = None
                        self.connected = False
                        time.sleep(1)
                        continue
                try:
                    pipe.write(('\n'.join(items) + '\n').encode('utf-8'))
                    pipe.flush()
                except Exception:
                    try:
                        pipe.close()
                    except Exception:
                        pass
                    pipe = None
                    self.connected = False

        def set_status(self, value):
            if value != self.status:
                self.status = value
                self.send('ToMe_RENPY status ' + value)

        def hide_wanted(self):
            if not self.connected:
                return False
            test = getattr(sys, '_megulit_renpy_hide', None)
            if test is not None:
                return bool(test())
            try:
                import ctypes
                k32 = ctypes.windll.kernel32
                if not self.hide_event:
                    now = time.time()
                    if now - self.hide_tried < 1.0:
                        return False
                    self.hide_tried = now
                    self.hide_event = k32.OpenEventW(0x00100000, False, u'Local\\MeguLitRenpyHide-%d' % os.getpid())
                    if not self.hide_event:
                        return False
                return k32.WaitForSingleObject(self.hide_event, 0) == 0
            except Exception:
                return False

        def redraw(self, d):
            try:
                if d is not None:
                    sys.modules['renpy.display.render'].redraw(d, 0)
            except Exception:
                pass

        def unhide(self):
            # MeguLit stopped asking (or went away): every Render drawn invisible is visible again, at once
            items, self.hidden = self.hidden, []
            for d, r in items:
                try:
                    r.alpha = 1.0
                except Exception:
                    pass
                self.redraw(d)

        def num(self, n):
            n = round(float(n), 2)
            return ('%d' % n) if n == int(n) else ('%s' % n)

        def chars_text(self, c):
            v = c['view']
            return 'ToMe_CHARS engine=renpy line=%d hidden=%d sw=%d sh=%d vx=%s vy=%s vw=%s vh=%s n=%d rects=%s text=%s' % (
                c['line'], 1 if c['hid'] else 0, c['sw'], c['sh'], v[0], v[1], v[2], v[3], len(c['rects']),
                ';'.join(','.join(self.num(n) for n in r) for r in c['rects']), c['text'])

        def viewport(self):
            # where the virtual screen sits in the window (letterbox), drawable pixels = client pixels on Windows
            draw = getattr(sys.modules.get('renpy.display'), 'draw', None)
            for name in ('drawable_viewport', 'physical_box'):
                b = getattr(draw, name, None)
                try:
                    if b is not None and len(b) == 4 and b[2] > 0 and b[3] > 0:
                        return tuple(self.num(n) for n in b)
                except Exception:
                    pass
            return ('0', '0', '0', '0')

        def line_text(self, kind, c, box):
            s = 'ToMe_RENPY %s line=%d same=%d nvl=%d x0=%d y0=%d x1=%d y1=%d size=%d sw=%d sh=%d n=%d' % (
                kind, c['line'], c['same'], c['nvl'], box[0], box[1], box[2], box[3], box[4], box[5], box[6], box[7])
            if kind == 'end':
                s += ' text=' + box[8]
            return s

        # ---- install --------------------------------------------------------------------------------------------------
        def refresh(self):
            m = sys.modules
            rr, tt, ch = m.get('renpy.display.render'), m.get('renpy.text.text'), m.get('renpy.character')
            if rr is None or tt is None or ch is None or not hasattr(rr, 'render_screen') or not hasattr(ch, 'display_say'):
                self.set_status('wait renpy')
                return
            self.Text, self.Render, self.identity = tt.Text, rr.Render, getattr(rr, 'IDENTITY', None)
            self.ch = ch
            if not getattr(rr.render_screen, '_megulit', False):
                rr.render_screen = self.wrap_screen(rr.render_screen)
            if hasattr(tt.Text, 'render') and not getattr(tt.Text.render, '_megulit', False):
                tt.Text.render = self.wrap_text_render(tt.Text.render)
            old = ch.display_say
            if not getattr(old, '_megulit', False):
                ch.display_say = self.wrap_say(old)
            ex = m.get('renpy.exports')
            if ex is not None and hasattr(ex, 'display_say') and not getattr(ex.display_say, '_megulit', False):
                ex.display_say = ch.display_say if ex.display_say is old else self.wrap_say(ex.display_say)
            r = m.get('renpy')
            if r is not None and hasattr(r, 'display_say') and not getattr(r.display_say, '_megulit', False):
                r.display_say = ch.display_say if r.display_say is old else self.wrap_say(r.display_say)
            self.set_status('ok')

        def wrap_text_render(self, orig):
            core = self

            def render(d, *a, **k):
                rv = orig(d, *a, **k)
                try:
                    if core.page and core.want:
                        for c in core.page:
                            if c['d'] is d or (c['d'] is None and core.matches(d, c)):
                                rv.alpha = 0.0
                                core.hidden.append((d, rv))
                                del core.hidden[:-64]
                                break
                except Exception:
                    pass
                return rv
            render._megulit = True
            return render

        def wrap_screen(self, orig):
            core = self

            def render_screen(*a, **k):
                core.want = core.hide_wanted()
                if not core.want and core.hidden:
                    core.unhide()
                rv = orig(*a, **k)
                c = core.cur
                if c is not None and not c['done']:
                    try:
                        core.locate(rv, c)
                    except Exception as e:
                        c['done'] = True
                        core.set_status('error locate %s' % (e,))
                if c is not None and c['rects'] is not None:
                    # hidden = this sentence's Text is drawn from a Render at alpha 0 (a cached one counts: Ren'Py
                    # draws the same object again); a Text rendered before hiding was asked for is re-rendered.
                    hid = core.want and any(d is c['d'] and r.alpha == 0.0 for d, r in core.hidden)
                    if core.want and not hid:
                        core.redraw(c['d'])
                    if hid != c['hid']:
                        c['hid'] = hid
                        core.send(core.chars_text(c))
                return rv
            render_screen._megulit = True
            return render_screen

        def wrap_say(self, orig):
            core = self

            def display_say(*a, **k):
                try:
                    what = a[1] if len(a) > 1 else k.get('what')
                    show = a[2] if len(a) > 2 else k.get('show_function')
                    core.say(what, show)
                except Exception as e:
                    core.set_status('error say %s' % (e,))
                return orig(*a, **k)
            display_say._megulit = True
            return display_say

        # ---- a new sentence -------------------------------------------------------------------------------------------
        def say(self, what, show):
            if not isinstance(what, text_types):
                return
            self.line += 1
            name = getattr(show, '__name__', '') or ''
            nvl = 1 if 'nvl' in name.lower() else 0
            same = 0
            if nvl:
                store = sys.modules.get('store')
                lst = getattr(store, 'nvl_list', None)
                same = 1 if lst and len(lst) > 1 else 0
            wanted = set([what])
            try:
                wanted.add(self.ch.DialogueTextTags(what).text)
            except Exception:
                pass
            c = {'line': self.line, 'same': same, 'nvl': nvl, 'wanted': wanted, 'flat': None, 'frames': 0, 'done': False,
                 'd': None, 'rects': None, 'hid': False, 'text': '', 'view': None, 'sw': 0, 'sh': 0}
            self.cur = c
            # what is hidden: the sentences of the page on screen (an NVL page keeps its earlier ones), else this one
            self.page = (self.page + [c])[-32:] if nvl and same else [c]
            if not nvl:
                # ADV: the page protocol keeps its single begin; the sentence is still located for its character boxes
                self.send(self.line_text('begin', c, (0, 0, 0, 0, 0, 0, 0, 0)))

        def flat_wanted(self, c):
            if c['flat'] is None:
                c['flat'] = set()
                try:
                    ex = sys.modules.get('renpy.text.extras')
                    for w in c['wanted']:
                        v = ruby_tags.sub('', w)
                        if ex is not None:
                            v = ex.filter_text_tags(v, allow=[])
                        c['flat'].add(blank.sub('', v))
                except Exception:
                    pass
            return c['flat']

        def matches(self, d, c):
            for v in (getattr(d, 'text_parameter', None), getattr(d, 'text', None)):
                if isinstance(v, (list, tuple)) and len(v) == 1:
                    v = v[0]
                if isinstance(v, text_types) and v in c['wanted']:
                    return True
            return False

        # ---- the frame ------------------------------------------------------------------------------------------------
        def locate(self, rv, c):
            c['frames'] += 1
            if c['frames'] > 240:
                c['done'] = True
                self.set_status('ok miss line=%d' % c['line'])
                return
            loose = []
            stack, seen = [(rv, 0.0, 0.0, None)], 0
            while stack:
                node, x, y, rev = stack.pop()
                seen += 1
                if seen > 20000:
                    break
                r = getattr(node, 'reverse', None)
                if r is not None and r is not self.identity:
                    rev = r if rev is None else rev * r
                for d in (getattr(node, 'render_of', None) or ()):
                    if isinstance(d, self.Text):
                        if self.matches(d, c):
                            if self.report(d, c, x, y, rev):
                                return
                        else:
                            loose.append((d, x, y, rev))
                kids = getattr(node, 'children', None) or ()
                for e in reversed(kids):
                    child = e[0]
                    if not isinstance(child, self.Render):
                        continue
                    xo, yo = e[1], e[2]
                    if rev is not None:
                        xo, yo = rev.transform(xo, yo)
                    stack.append((child, x + xo, y + yo, rev))
            # No Text holds the string as given (a screen that rebuilt it): compare what is drawn, ruby left out.
            flat = self.flat_wanted(c)
            for d, x, y, rev in loose[:64]:
                rows = self.rows(d)
                if rows and blank.sub('', ''.join(''.join(r[1]) for r in rows)) in flat:
                    if self.report(d, c, x, y, rev, rows):
                        return

        def rows(self, d):
            get = getattr(d, 'get_layout', None)
            layout = get() if get is not None else None
            lines = getattr(layout, 'lines', None) if layout is not None else None
            if not lines:
                return None
            ox, oy = getattr(layout, 'xoffset', 0) or 0, getattr(layout, 'yoffset', 0) or 0
            unscale = getattr(layout, 'unscale_pair', None) or (lambda a, b: (a, b))
            glyphs = [g for ln in lines for g in ln.glyphs]
            base = 0
            kinds = set(getattr(g, 'ruby', 0) for g in glyphs)
            if len(kinds) > 1:
                # Ruby: of the marked glyphs, the base text is the group drawn larger (ruby_t's numbering is not public).
                sizes = {}
                for g in glyphs:
                    k = getattr(g, 'ruby', 0)
                    a = sizes.setdefault(k, [0, 0])
                    a[0] += getattr(g, 'ascent', 0) or 0
                    a[1] += 1
                marked = [k for k in sizes if k]
                top = set(marked) - set([max(marked, key=lambda k: sizes[k][0] / float(sizes[k][1]))]) if len(marked) > 1 else set()
            else:
                top = set()
            out = []
            for ln in lines:
                chars, xs, ws = [], [], []
                for g in ln.glyphs:
                    code = getattr(g, 'character', 0)
                    if code < 32 or code in skip or getattr(g, 'ruby', 0) in top:
                        continue
                    gx, gy = unscale(g.x + ox, ln.y + oy)
                    chars.append(unichr_(code))
                    xs.append(gx)
                    ws.append(unscale(getattr(g, 'advance', 0) or getattr(g, 'width', 0) or 0, 0)[0])
                if chars:
                    # a glyph without its own width (some builds) spans to the next one on its row
                    for i in range(len(ws)):
                        if ws[i] <= 0:
                            ws[i] = (xs[i + 1] - xs[i]) if i + 1 < len(xs) and xs[i + 1] > xs[i] else (ws[i - 1] if i else unscale(0, ln.height)[1])
                    top_y = unscale(0, ln.y + oy)[1]
                    out.append((top_y, chars, xs, unscale(0, ln.height)[1], ws))
            return out

        def report(self, d, c, x, y, rev, rows=None):
            rows = rows if rows is not None else self.rows(d)
            if not rows:
                return False
            pts, rects = [], []
            for top_y, chars, xs, h, ws in rows:
                for gx, gw in zip(xs, ws):
                    px, py = (rev.transform(gx, top_y) if rev is not None else (gx, top_y))
                    qx, qy = (rev.transform(gx + gw, top_y + h) if rev is not None else (gx + gw, top_y + h))
                    pts.append((x + px, y + py))
                    rects.append((x + min(px, qx), y + min(py, qy), abs(qx - px), abs(qy - py)))
            size = getattr(getattr(d, 'style', None), 'size', None)
            if not isinstance(size, (int, float)) or size <= 0:
                size = rows[0][3]
            if rev is not None:
                a, b = rev.transform(0, 0), rev.transform(0, size)
                size = abs(b[1] - a[1]) or size
            config = sys.modules.get('renpy.config')
            sw, sh = getattr(config, 'screen_width', 0) or 0, getattr(config, 'screen_height', 0) or 0
            text = '\n'.join(''.join(r[1]) for r in rows)
            n = sum(len(r[1]) for r in rows)
            xs0 = [p[0] for p in pts]
            first_y, last_y = pts[0][1], pts[-1][1]
            box = (int(round(min(xs0))), int(round(first_y)), int(round(max(xs0))), int(round(max(last_y, first_y))),
                   int(round(size)), int(sw), int(sh), n, text)
            c['done'] = True
            if c['nvl']:
                self.send(self.line_text('begin', c, box))
                self.send(self.line_text('end', c, box))
            c['d'], c['rects'], c['text'], c['sw'], c['sh'], c['view'] = d, rects, text.replace('\n', '\x1f'), int(sw), int(sh), self.viewport()
            c['hid'] = self.want and any(h is d and r.alpha == 0.0 for h, r in self.hidden)
            self.send(self.chars_text(c))
            return True

    core = Core()
    sys._megulit_renpy = core
    try:
        core.refresh()
    except Exception as e:
        core.set_status('error install %s' % (e,))


try:
    _megulit_renpy_main()
except Exception:
    pass
try:
    del _megulit_renpy_main
except Exception:
    pass
