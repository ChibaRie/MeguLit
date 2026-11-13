// SPDX-License-Identifier: GPL-3.0-or-later
// Minimal JSON for the compositor's line protocol (one object per stdin/stdout line). Strings are UTF-8 in and out;
// \uXXXX escapes incl. surrogate pairs are decoded.
#pragma once
#include <cstdio>
#include <cstdlib>
#include <map>
#include <memory>
#include <string>
#include <vector>

namespace megu {

struct Json {
  enum Kind { Null, Bool, Num, Str, Arr, Obj } kind = Null;
  bool b = false; double n = 0; std::string s; std::vector<Json> a; std::map<std::string, Json> o;
  const Json &operator[](const std::string &k) const { static const Json none; auto it = o.find(k); return it == o.end() ? none : it->second; }
  const Json &operator[](size_t i) const { static const Json none; return i < a.size() ? a[i] : none; }
  bool has(const std::string &k) const { return o.count(k) != 0; }
  double num(double d = 0) const { return kind == Num ? n : kind == Bool ? (b ? 1 : 0) : d; }
  bool truthy(bool d = false) const { return kind == Bool ? b : kind == Num ? n != 0 : d; }
  const std::string &str() const { static const std::string e; return kind == Str ? s : e; }
  size_t size() const { return kind == Arr ? a.size() : 0; }

  static Json Parse(const std::string &t) { size_t i = 0; Json j; if (!Value(t, i, j)) return Json(); return j; }

private:
  static void Ws(const std::string &t, size_t &i) { while (i < t.size() && (t[i] == ' ' || t[i] == '\t' || t[i] == '\r' || t[i] == '\n')) ++i; }
  static void Utf8(std::string &out, unsigned cp) {
    if (cp < 0x80) out += char(cp);
    else if (cp < 0x800) { out += char(0xC0 | (cp >> 6)); out += char(0x80 | (cp & 0x3F)); }
    else if (cp < 0x10000) { out += char(0xE0 | (cp >> 12)); out += char(0x80 | ((cp >> 6) & 0x3F)); out += char(0x80 | (cp & 0x3F)); }
    else { out += char(0xF0 | (cp >> 18)); out += char(0x80 | ((cp >> 12) & 0x3F)); out += char(0x80 | ((cp >> 6) & 0x3F)); out += char(0x80 | (cp & 0x3F)); }
  }
  static bool String(const std::string &t, size_t &i, std::string &out) {
    if (t[i] != '"') return false; ++i;
    while (i < t.size() && t[i] != '"') {
      if (t[i] != '\\') { out += t[i++]; continue; }
      if (++i >= t.size()) return false;
      const char e = t[i++];
      switch (e) {
        case 'n': out += '\n'; break; case 't': out += '\t'; break; case 'r': out += '\r'; break; case 'b': out += '\b'; break; case 'f': out += '\f'; break;
        case 'u': {
          if (i + 4 > t.size()) return false;
          unsigned cp = std::strtoul(t.substr(i, 4).c_str(), nullptr, 16); i += 4;
          if (cp >= 0xD800 && cp < 0xDC00 && i + 6 <= t.size() && t[i] == '\\' && t[i + 1] == 'u') { unsigned lo = std::strtoul(t.substr(i + 2, 4).c_str(), nullptr, 16); if (lo >= 0xDC00 && lo < 0xE000) { cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00); i += 6; } }
          Utf8(out, cp); break;
        }
        default: out += e;
      }
    }
    if (i >= t.size()) return false; ++i; return true;
  }
  static bool Value(const std::string &t, size_t &i, Json &j) {
    Ws(t, i); if (i >= t.size()) return false;
    const char c = t[i];
    if (c == '{') {
      j.kind = Obj; ++i; Ws(t, i); if (i < t.size() && t[i] == '}') { ++i; return true; }
      while (i < t.size()) { Ws(t, i); std::string k; if (!String(t, i, k)) return false; Ws(t, i); if (i >= t.size() || t[i] != ':') return false; ++i; Json v; if (!Value(t, i, v)) return false; j.o[k] = std::move(v); Ws(t, i); if (i < t.size() && t[i] == ',') { ++i; continue; } if (i < t.size() && t[i] == '}') { ++i; return true; } return false; }
      return false;
    }
    if (c == '[') {
      j.kind = Arr; ++i; Ws(t, i); if (i < t.size() && t[i] == ']') { ++i; return true; }
      while (i < t.size()) { Json v; if (!Value(t, i, v)) return false; j.a.push_back(std::move(v)); Ws(t, i); if (i < t.size() && t[i] == ',') { ++i; continue; } if (i < t.size() && t[i] == ']') { ++i; return true; } return false; }
      return false;
    }
    if (c == '"') { j.kind = Str; return String(t, i, j.s); }
    if (t.compare(i, 4, "true") == 0) { j.kind = Bool; j.b = true; i += 4; return true; }
    if (t.compare(i, 5, "false") == 0) { j.kind = Bool; j.b = false; i += 5; return true; }
    if (t.compare(i, 4, "null") == 0) { j.kind = Null; i += 4; return true; }
    char *end = nullptr; j.n = std::strtod(t.c_str() + i, &end); if (end == t.c_str() + i) return false; j.kind = Num; i = size_t(end - t.c_str()); return true;
  }
};

inline std::string JsonEscape(const std::string &s) {
  std::string o; o.reserve(s.size() + 8);
  for (unsigned char c : s) {
    if (c == '"' || c == '\\') { o += '\\'; o += char(c); }
    else if (c == '\n') o += "\\n"; else if (c == '\r') o += "\\r"; else if (c == '\t') o += "\\t";
    else if (c < 0x20) { char b[8]; std::snprintf(b, sizeof b, "\\u%04x", c); o += b; }
    else o += char(c);
  }
  return o;
}

} // namespace megu
