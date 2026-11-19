#pragma once
/* MeguLit 2026-11-19 (one hook runtime): the exact-program adapters that had runtimes of their own (runtime/hook-island,
   runtime/hook-mages[-e201]), now engines of MeguLitHook32. Each matches only the program it always matched, so no other
   game sees them; enginecollection32.cpp lists them first. */
#include "engine32/ToMeIslandDraw.h"
#include "MeguLitMatch.h"
/* ISLAND (CatSystem2): ISLAND.exe whose whole file has the supported SHA-256 (ToMeIslandDraw::ExactFile) */
class ToMeIsland : public ENGINE {
public:
  ToMeIsland() { check_by = CHECK_BY::CUSTOM; check_by_target = []() { return MeguLitMatch::Island(processName, !_wcsicmp(processName, L"ISLAND.exe") && ToMeIslandDraw::ExactFile()); }; }
  bool attach_function() override { return ToMeIslandDraw::Install(); }
};
