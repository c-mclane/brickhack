#!/usr/bin/env python3
"""Hook NetHack / SLASH'EM core files into the web window port's block world.

  hack.c   test_move: hero may climb onto blocks/walls the client approved;
           NetHack-initiated moves (running, travel) never walk into blocks
  mon.c    mfndpos:   monsters can't step into squares with placed blocks
  mhitu.c  mattacku:  ground monsters can't melee a hero standing 2+ blocks up
  u_init.c u_init:    every role starts with a pick-axe

Idempotent: each hook is tagged with WEB_HOOK and skipped if present.
usage: patch_engine.py <source dir>
"""
import re
import sys

src = sys.argv[1]
TAG = "/* WEB_HOOK */"


def patch(rel, decl, pattern, insert, after=True):
    path = f"{src}/{rel}"
    s = open(path, encoding="latin-1").read()
    if TAG in s:
        return
    m = re.search(pattern, s, re.M)
    if not m:
        sys.exit(f"patch_engine: anchor not found in {rel}: {pattern}")
    # insert after the match, or before its last group when after=False
    pos = m.end() if after else m.start(m.lastindex or 0)
    s = s[:pos] + insert + s[pos:]
    if decl:
        s = s.replace('#include "hack.h"\n', '#include "hack.h"\n' + decl + "\n", 1)
    open(path, "w", encoding="latin-1").write(s)


# hack.c: first thing test_move does after its declarations
patch("src/hack.c",
      "extern int FDECL(web_test_move, (int, int, int)); " + TAG,
      r"^test_move\((?:.|\n)*?register struct rm \*ust;\n",
      "\n    { " + TAG + "\n        int webr = web_test_move(x, y, mode);\n"
      "        if (webr >= 0)\n            return (boolean) webr;\n    }\n")

# mon.c: inside the neighbour loop of mfndpos
patch("src/mon.c",
      "extern int FDECL(web_cell_blocked, (int, int)); " + TAG,
      r"^mfndpos\((?:.|\n)*?if\s*\(nx == x && ny == y\)\s*\n?\s*continue;\n",
      "            if (web_cell_blocked(nx, ny)) " + TAG + "\n                continue;\n")

# mhitu.c: before mattacku's first statement
patch("src/mhitu.c",
      "extern int FDECL(web_mon_cant_reach, (struct monst *)); " + TAG,
      r"^mattacku\((?:.|\n)*?\n(\s*if\s*\(\s*!ranged\s*\)\s*\n?\s*nomul\(0\);)",
      "    if (web_mon_cant_reach(mtmp)) " + TAG + "\n        return 0;\n",
      after=False)

# u_init.c: give everyone a pick-axe before race-specific setup
patch("src/u_init.c", None,
      r"\n(\s*/\*\*\* Race-specific initializations \*\*\*/)",
      "\n    { " + TAG + " /* NetHack 3D: everyone starts with a pick-axe */\n"
      "        static struct trobj Pickaxe[] = { { PICK_AXE, 0, TOOL_CLASS, 1, UNDEF_BLESS },\n"
      "                                          { 0, 0, 0, 0, 0 } };\n"
      "        if (!carrying(PICK_AXE) && !carrying(DWARVISH_MATTOCK))\n"
      "            ini_inv(Pickaxe);\n    }\n",
      after=False)

# ---- MineHack: a bigger map (SLASH'EM coordinates are signed chars: max 127)
def edit(rel, pairs, tag):
    path = f"{src}/{rel}"
    s = open(path, encoding="latin-1").read()
    if tag in s:
        return
    for a, b in pairs:
        if a not in s:
            sys.exit(f"patch_engine: anchor not found in {rel}: {a[:60]}")
        s = s.replace(a, b, 1)
    open(path, "w", encoding="latin-1").write(s)

edit("include/global.h", [("#define COLNO	80", "#define COLNO	120 /* MineHack: bigger maps; WEB_HOOK_MAPSIZE */"),
                          ("#define ROWNO	21", "#define ROWNO	64")], "WEB_HOOK_MAPSIZE")
edit("include/sp_lev.h", [("#define MAP_X_LIM	76", "#define MAP_X_LIM	118 /* WEB_HOOK_MAPSIZE */"),
                          ("#define MAP_Y_LIM	21", "#define MAP_Y_LIM	62")], "WEB_HOOK_MAPSIZE")
# the Planes of Air/Water hardcode the old 80x21 area; shift it to the centred map
edit("src/mkmaze.c", [("	xmin = 3;\n	ymin = 1;\n	xmax = 78;\n	ymax = 20;",
                       "	xmin = 3 + (COLNO - 80) / 2; /* WEB_HOOK_MAPSIZE */\n	ymin = 1 + (ROWNO - 21) / 2;\n	xmax = 78 + (COLNO - 80) / 2;\n	ymax = 20 + (ROWNO - 21) / 2;")],
     "WEB_HOOK_MAPSIZE")

# the level compiler keeps a whole MAP in a 4096-byte buffer: room for 118x62
for rel in ("util/lev_comp.l", "sys/share/lev_lex.c"):
    edit(rel, [("static char map[4096];", "static char map[16384]; /* WEB_HOOK_MAPSIZE */")], "WEB_HOOK_MAPSIZE")

# ---- MineHack Dreamland: an overland start level, its own story, swimming
edit("include/flag.h", [("	boolean  legacy;	/* print game entry \"story\" */",
                         "	boolean  legacy;	/* print game entry \"story\" */\n	boolean  dreamland;	/* MineHack: start in Dreamland; WEB_HOOK_DREAM */")],
     "WEB_HOOK_DREAM")
edit("src/options.c", [('	{"legacy", &flags.legacy, TRUE, DISP_IN_GAME},',
                        '	{"legacy", &flags.legacy, TRUE, DISP_IN_GAME},\n	{"dreamland", &flags.dreamland, FALSE, SET_IN_FILE}, /* WEB_HOOK_DREAM */')],
     "WEB_HOOK_DREAM")
# the first level of the Dungeons of Doom is the Dreamland overland
# (mklev.c holds only Dreamland's hook: start from SLASH'EM's own copy each
# build, so the hook can change)
import subprocess as _sp
_sp.run(["git", "-C", src, "checkout", "--", "src/mklev.c"], check=True)
# Dreamland's levels (Ascend): level n of the first dungeon is "dreamln<n>"
# (the first, "dreamlnd"), up to DREAM_LEVELS (dreamlnd.h, from
# tools/dreamland_gen.py)
edit("src/mklev.c", [("	    register s_level *slev = Is_special(&u.uz);\n",
                      "	    register s_level *slev = Is_special(&u.uz);\n\n"
                      "	    if (flags.dreamland && u.uz.dnum == 0 && u.uz.dlevel <= DREAM_LEVELS) { /* WEB_HOOK_DREAM */\n"
                      "		char dname[16]; /* (level names are max 8 chars) */\n"
                      "		if (u.uz.dlevel == 1) Strcpy(dname, \"dreamlnd\");\n"
                      "		else Sprintf(dname, \"dreamln%d\", (int) u.uz.dlevel);\n"
                      "		makemaz(dname);\n		return;\n	    }\n"),
                     ("#include \"hack.h\"\n", "#include \"hack.h\"\n#include \"dreamlnd.h\" /* WEB_HOOK_DREAM: DREAM_LEVELS */\n")],
     "WEB_HOOK_DREAM")
edit("src/allmain.c", [("	if (flags.legacy) {\n		flush_screen(1);\n		com_pager(1);\n	}",
                        "	if (flags.dreamland) { /* WEB_HOOK_DREAM */\n		extern void NDECL(web_dreamland_intro);\n"
                        "		flush_screen(1);\n		web_dreamland_intro();\n	} else if (flags.legacy) {\n		flush_screen(1);\n		com_pager(1);\n	}")],
     "WEB_HOOK_DREAM")
# BrickHack: a character's figure can start it with more than its role's kit
# (the server's LEGOHACK_KIT, from the design: a Catholic priest's hosts;
# winweb.c web_kit_item), unless it already has some
edit("src/u_init.c", [("            ini_inv(Pickaxe);\n    }\n",
                       "            ini_inv(Pickaxe);\n    }\n"
                       "    { /* WEB_HOOK_KIT */\n"
                       "        extern int FDECL(web_kit_item, (int, int *));\n"
                       "        struct trobj kit[2];\n"
                       "        int i, otyp, quan;\n"
                       "        for (i = 0; (otyp = web_kit_item(i, &quan)) >= 0; i++) {\n"
                       "            if (!otyp || carrying(otyp)) continue;\n"
                       "            kit[0].trotyp = otyp; kit[0].trspe = UNDEF_SPE; kit[0].trclass = objects[otyp].oc_class;\n"
                       "            kit[0].trquan = quan; kit[0].trbless = UNDEF_BLESS;\n"
                       "            kit[1].trotyp = 0; kit[1].trspe = 0; kit[1].trclass = 0; kit[1].trquan = 0; kit[1].trbless = 0;\n"
                       "            ini_inv(kit);\n"
                       "        }\n"
                       "    }\n")],
     "WEB_HOOK_KIT")
# ...and the kit is just what the design names: none of the role's swaps by
# race or alignment (a chaotic priest's holy wafers turned lembas)
edit("src/u_init.c", [("STATIC_DCL void FDECL(ini_inv, (struct trobj *));\n",
                       "STATIC_DCL void FDECL(ini_inv, (struct trobj *));\n"
                       "static int web_kit_exact = 0; /* WEB_HOOK_KITEXACT: giving the design's kit (no swaps) */\n"),
                      ("			if (urace.malenum != PM_HUMAN) {\n			    /* substitute specific items for generic ones */\n",
                       "			if (!web_kit_exact && urace.malenum != PM_HUMAN) {\n			    /* substitute specific items for generic ones */\n"),
                      ("			for (i = 0; inv_asubs[i].align != A_NONE; ++i)\n",
                       "			if (!web_kit_exact) for (i = 0; inv_asubs[i].align != A_NONE; ++i)\n"),
                      ("            ini_inv(kit);\n",
                       "            web_kit_exact = 1;\n            ini_inv(kit);\n            web_kit_exact = 0;\n")],
     "WEB_HOOK_KITEXACT")
# BrickHack: holy wine, the Catholic priest's chalice (with his hosts: the
# figure's kit, LEGOHACK_KIT): a potion in a golden goblet, never made at random
# (only his, or set in a level), always known, its look never shuffled (it
# follows water, as the fixed ones do); drunk, it heals fully and restores
edit("src/objects.c", [('POTION("amnesia", "sparkling",          1, 0,          16, 100, CLR_CYAN),\n',
                        'POTION("amnesia", "sparkling",          1, 0,          16, 100, CLR_CYAN),\n'
                        'POTION("holy wine", "golden goblet",    1, 0,           0, 300, CLR_YELLOW), /* WEB_HOOK_HOLYWINE */\n')],
     "WEB_HOOK_HOLYWINE")
edit("src/o_init.c", [("	/* shuffle descriptions */\n	shuffle_all();\n",
                       "	objects[POT_HOLY_WINE].oc_name_known = 1; /* WEB_HOOK_HOLYWINE */\n"
                       "	/* shuffle descriptions */\n	shuffle_all();\n")],
     "WEB_HOOK_HOLYWINE")
edit("src/potion.c", [("	case POT_FULL_HEALING:\n		You_feel(\"completely healed.\");\n",
                       "	case POT_HOLY_WINE: /* WEB_HOOK_HOLYWINE: the chalice: whole in body and soul */\n"
                       "		pline(\"A warm, holy light fills you.\");\n"
                       "		healup(400, 8, TRUE, TRUE);\n"
                       "		if (Upolyd) u.mh = u.mhmax;\n"
                       "		u.uen = u.uenmax;\n"
                       "		for (i = 0; i < A_MAX; i++)\n"
                       "		    if (ABASE(i) < AMAX(i)) ABASE(i) = AMAX(i);\n"
                       "		if (u.ulevel < u.ulevelmax) {\n"
                       "		    u.ulevelmax -= 1;\n"
                       "		    pluslvl(FALSE);\n"
                       "		}\n"
                       "		(void) make_hallucinated(0L, TRUE, 0L);\n"
                       "		make_confused(0L, TRUE);\n"
                       "		make_stunned(0L, TRUE);\n"
                       "		if (Stoned) fix_petrification();\n"
                       "		if (Slimed) Slimed = 0L;\n"
                       "		flags.botl = 1;\n"
                       "		exercise(A_WIS, TRUE);\n"
                       "		exercise(A_CON, TRUE);\n"
                       "		break;\n"
                       "	case POT_FULL_HEALING:\n		You_feel(\"completely healed.\");\n"),
                      ("	case POT_FULL_HEALING:\n		if (mon->data == &mons[PM_PESTILENCE]) goto do_illness;\n",
                       "	case POT_HOLY_WINE: /* WEB_HOOK_HOLYWINE */\n"
                       "	case POT_FULL_HEALING:\n		if (mon->data == &mons[PM_PESTILENCE]) goto do_illness;\n")],
     "WEB_HOOK_HOLYWINE")
# ...and its sprite, after amnesia's (the tile files are read in order)
edit("win/share/objects.txt", [("# tile 368 (LEP GEX VEN ZEA / create monster)\n",
"""# tile 384 (golden goblet / holy wine)\n{\n  MMMMMMMMMMMMMMMM\n  MMMMMMMMMMMMMMMM\n  MMMAAAAAAAAAAMMM\n  MMMAHHHHHHHHAMMM\n  MMMAHDDDDDDHAMMM\n  MMMAHNDDDDDHAMMM\n  MMMMAHDDDDHCAMMM\n  MMMMMAHHHHCAMMMM\n  MMMMMMAHHCAMMMMM\n  MMMMMMMAHAMMMMMM\n  MMMMMMMAHAMMMMMM\n  MMMMMMMAHAMMMMMM\n  MMMMMMAHHCAMMMMM\n  MMMMMAHHHHCAMMMM\n  MMMMAAAAAAAAMMMM\n  MMMMMMMMMMMMMMMM\n}\n# tile 368 (LEP GEX VEN ZEA / create monster)\n""")],
     "golden goblet / holy wine")
# ...and drunk glass after glass it goes to your head: another within 100
# turns makes you really drunk, for hundreds of turns (winweb.c
# web_holy_wine_sip, before the wine's cures, and web_holy_wine, after them)
edit("src/potion.c", [("	case POT_HOLY_WINE: /* WEB_HOOK_HOLYWINE: the chalice: whole in body and soul */\n",
                       "	case POT_HOLY_WINE: /* WEB_HOOK_HOLYWINE: the chalice: whole in body and soul */\n"
                       "		{ extern void NDECL(web_holy_wine_sip); web_holy_wine_sip(); } /* WEB_HOOK_DRUNK */\n")],
     "WEB_HOOK_DRUNK")
# (the chalice was a wine glass once: a tree an earlier build patched says so;
# made to say chalice before the edits below look for their tags)
def rename(rel, pairs):
    path = f"{src}/{rel}"
    s = open(path, encoding="latin-1").read()
    t = s
    for a, b in pairs:
        t = t.replace(a, b)
    if t != s:
        open(path, "w", encoding="latin-1").write(t)

rename("src/objects.c", [("TOOL(\"wine glass\", (char *)0,   1, 1, 0, 0,   0,   3,   5, GLASS, HI_GLASS), /* WEB_HOOK_GLASS */\n", "TOOL(\"chalice\", (char *)0,      1, 1, 0, 0,   0,  20,  50, GOLD, HI_GOLD), /* WEB_HOOK_GLASS */\n")])
rename("win/share/objects.txt", [("# tile 298 (wine glass)\n{\n  MMMMMMMMMMMMMMMM\n  MMMMMMMMMMMMMMMM\n  MMMMMBBBBBBMMMMM\n  MMMMBNPPPPPBMMMM\n  MMMMBNPPPPPBMMMM\n  MMMMBNPPPPPBMMMM\n  MMMMMBNPPPBMMMMM\n  MMMMMMBBBBMMMMMM\n  MMMMMMMBBMMMMMMM\n  MMMMMMMBBMMMMMMM\n  MMMMMMMBBMMMMMMM\n  MMMMMMMBBMMMMMMM\n  MMMMMMBBBBMMMMMM\n  MMMMBBBBBBBBMMMM\n  MMMMMMMMMMMMMMMM\n  MMMMMMMMMMMMMMMM\n}\n", "# tile 298 (chalice)\n{\n  MMMMMMMMMMMMMMMM\n  MMMMMMMMMMMMMMMM\n  MMMAAAAAAAAAAMMM\n  MMMAHKKKKKKHAMMM\n  MMMAHNKKKKKHAMMM\n  MMMAHHKKKKHCAMMM\n  MMMMAHHHHHHCAMMM\n  MMMMMAHHHHCAMMMM\n  MMMMMMAHHCAMMMMM\n  MMMMMMMAHAMMMMMM\n  MMMMMMMAHAMMMMMM\n  MMMMMMMAHAMMMMMM\n  MMMMMMAHHCAMMMMM\n  MMMMMAHHHHCAMMMM\n  MMMMAAAAAAAAMMMM\n  MMMMMMMMMMMMMMMM\n}\n")])
rename("src/potion.c", [("mksobj(WINE_GLASS, FALSE, FALSE)", "mksobj(CHALICE, FALSE, FALSE)"),
                        ("\"You set the empty glass down.\"", "\"You set the empty chalice down.\"")])
# BrickHack: the chalice, plain gold (a tool, never made at random): what's
# left when holy wine is drunk; prayer fills it again (winweb.c
# web_fill_glasses: on an altar, or anywhere for a Catholic priest or bishop);
# thrown, it shatters and is gone
edit("src/objects.c", [("		TOOL_CLASS, 0, 0,10, 5000, 0, 0, 0, 0, 50, HI_SILVER),\n#undef TOOL\n",
                        "		TOOL_CLASS, 0, 0,10, 5000, 0, 0, 0, 0, 50, HI_SILVER),\n"
                        "TOOL(\"chalice\", (char *)0,      1, 1, 0, 0,   0,  20,  50, GOLD, HI_GOLD), /* WEB_HOOK_GLASS */\n"
                        "#undef TOOL\n")],
     "WEB_HOOK_GLASS")
edit("win/share/objects.txt", [("# tile 298 (tripe ration)\n",
"""# tile 298 (chalice)\n{\n  MMMMMMMMMMMMMMMM\n  MMMMMMMMMMMMMMMM\n  MMMAAAAAAAAAAMMM\n  MMMAHKKKKKKHAMMM\n  MMMAHNKKKKKHAMMM\n  MMMAHHKKKKHCAMMM\n  MMMMAHHHHHHCAMMM\n  MMMMMAHHHHCAMMMM\n  MMMMMMAHHCAMMMMM\n  MMMMMMMAHAMMMMMM\n  MMMMMMMAHAMMMMMM\n  MMMMMMMAHAMMMMMM\n  MMMMMMAHHCAMMMMM\n  MMMMMAHHHHCAMMMM\n  MMMMAAAAAAAAMMMM\n  MMMMMMMMMMMMMMMM\n}\n# tile 298 (tripe ration)\n""")],
     "(chalice)")
edit("src/potion.c", [("		exercise(A_WIS, TRUE);\n		exercise(A_CON, TRUE);\n		break;\n	case POT_FULL_HEALING:\n",
                       "		exercise(A_WIS, TRUE);\n		exercise(A_CON, TRUE);\n"
                       "		{ extern void NDECL(web_holy_wine); web_holy_wine(); } /* WEB_HOOK_GLASS: drunk; peace with the figure's own god */\n"
                       "		{ /* WEB_HOOK_GLASS: the wine drunk, its glass stays */\n"
                       "		    struct obj *glass = mksobj(CHALICE, FALSE, FALSE);\n"
                       "		    glass->blessed = otmp->blessed;\n"
                       "		    glass->cursed = otmp->cursed;\n"
                       "		    (void) hold_another_object(glass, \"You set the empty chalice down.\",\n"
                       "					       (const char *)0, (const char *)0);\n"
                       "		}\n"
                       "		break;\n	case POT_FULL_HEALING:\n")],
     "WEB_HOOK_GLASS")
edit("src/pray.c", [("	pleased(alignment); /* nice */\n    }\n    return(1);\n}\n",
                     "	pleased(alignment); /* nice */\n    }\n"
                     "    { extern void NDECL(web_fill_glasses); web_fill_glasses(); } /* WEB_HOOK_GLASS */\n"
                     "    return(1);\n}\n")],
     "WEB_HOOK_GLASS")
# BrickHack: a figure's own deity (the server's LEGOHACK_GOD, from its design:
# Jesus, for the Catholic priest, the monastic orders and the crusading
# knights), the lawful god (its followers are lawful: the server sets
# align:lawful); set again on every restore
edit("src/role.c", [("	    urole.cgod = roles[flags.pantheon].cgod;\n	}\n",
                     "	    urole.cgod = roles[flags.pantheon].cgod;\n	}\n"
                     "	{ /* WEB_HOOK_GOD */\n"
                     "	    static char web_god[64];\n"
                     "	    const char *g = getenv(\"LEGOHACK_GOD\");\n"
                     "	    if (g && *g) {\n"
                     "		(void) strncpy(web_god, g, sizeof web_god - 1);\n"
                     "		urole.lgod = web_god;\n"
                     "	    }\n"
                     "	}\n")],
     "WEB_HOOK_GOD")
# BrickHack: the intro story (com_pager 1) told to a follower of the figure's
# own deity (Jesus): the cruel god who stole the Amulet is Satan (winweb.c
# web_intro_line); Moloch stays Moloch everywhere else
edit("src/questpgr.c", [("STATIC_OVL void\ndeliver_by_window(qt_msg, how)\n",
                         "static int web_intro = 0; /* WEB_HOOK_INTRO: telling the intro story */\n"
                         "STATIC_OVL void\ndeliver_by_window(qt_msg, how)\n"),
                        ("	    convert_line();\n	    putstr(datawin, 0, out_line);\n",
                         "	    convert_line();\n"
                         "	    if (web_intro) { extern void FDECL(web_intro_line, (char *)); web_intro_line(out_line); }\n"
                         "	    putstr(datawin, 0, out_line);\n"),
                        ("	else if (msgnum == 1) deliver_by_window(qt_msg, NHW_MENU);\n",
                         "	else if (msgnum == 1) {\n"
                         "	    web_intro = 1;\n"
                         "	    deliver_by_window(qt_msg, NHW_MENU);\n"
                         "	    web_intro = 0;\n"
                         "	}\n")],
     "WEB_HOOK_INTRO")
# ...and a chalice thrown shatters, gold or no: gone for good
edit("src/dothrow.c", [("		case POT_WATER:		/* really, all potions */\n		case EGG:\n		case CREAM_PIE:\n",
                        "		case CHALICE:		/* WEB_HOOK_CHALICE: thrown, it shatters */\n"
                        "		case POT_WATER:		/* really, all potions */\n		case EGG:\n		case CREAM_PIE:\n"),
                       ("		case CRYSTAL_BALL:\n",
                        "		case CRYSTAL_BALL:\n		case CHALICE:		/* WEB_HOOK_CHALICE */\n")],
     "WEB_HOOK_CHALICE")
# BrickHack: a follower of the figure's own deity (Jesus) who sets a chalice
# on another god's altar claims it for him on the spot (winweb.c
# web_altar_glass): it turns lawful, its priest turns on you
edit("src/do.c", [("	register struct obj *obj;\n{\n	if (Blind)\n		return;\n\n	/* KMH, conduct */\n",
                   "	register struct obj *obj;\n{\n"
                   "	{ extern void FDECL(web_altar_glass, (struct obj *)); web_altar_glass(obj); } /* WEB_HOOK_ALTARGLASS */\n"
                   "	if (Blind)\n		return;\n\n	/* KMH, conduct */\n")],
     "WEB_HOOK_ALTARGLASS")
# BrickHack: the rites of a follower of the figure's own deity (Jesus), in
# place of burnt offerings, which he refuses (his sacrifice was once for all):
# #mass (a priest or bishop), #communion, #alms, #confess; winweb.c web_offer,
# web_mass, web_communion, web_alms, web_confess
edit("src/cmd.c", [("struct ext_func_tab extcmdlist[] = {\n",
                    "extern int NDECL(web_mass), NDECL(web_communion), NDECL(web_alms), NDECL(web_confess); /* WEB_HOOK_RITES */\n"
                    "struct ext_func_tab extcmdlist[] = {\n"),
                   ("	{\"offer\", \"offer a sacrifice to the gods\", dosacrifice, FALSE},\n",
                    "	{\"offer\", \"offer a sacrifice to the gods\", dosacrifice, FALSE},\n"
                    "	{\"mass\", \"celebrate Mass at an altar of your god\", web_mass, FALSE},\n"
                    "	{\"communion\", \"receive Communion at an altar of your god\", web_communion, FALSE},\n"
                    "	{\"alms\", \"give alms at an altar of your god\", web_alms, FALSE},\n"
                    "	{\"confess\", \"confess your sins at an altar of your god\", web_confess, FALSE},\n")],
     "WEB_HOOK_RITES")
edit("src/pray.c", [("    web_dream_sacrifice(); /* WEB_HOOK_ALTAR: anything offered */\n",
                     "    web_dream_sacrifice(); /* WEB_HOOK_ALTAR: anything offered */\n"
                     "    if (!orac) { extern int FDECL(web_offer, (struct obj *)); if (web_offer(otmp)) return 1; } /* WEB_HOOK_RITES */\n")],
     "WEB_HOOK_RITES")
# BrickHack: a chalice is fragile: dropped anywhere but on an altar (where it's
# set down) it shatters, as thrown; the hero keeps count of those lost (saved
# with the game), and a follower's prayer brings one back, somewhere in the
# room (winweb.c web_fill_glasses)
edit("include/you.h", [("	boolean twoweap;		/* KMH -- using two-weapon combat */\n",
                        "	boolean twoweap;		/* KMH -- using two-weapon combat */\n"
                        "	int webchalices;	/* WEB_HOOK_CHALICE2: chalices shattered, owed back by prayer */\n")],
     "WEB_HOOK_CHALICE2")
edit("src/dothrow.c", [("boolean from_invent;\n{\n	int am;\n	if (IS_ALTAR(levl[x][y].typ))\n",
                        "boolean from_invent;\n{\n	int am;\n"
                        "	if (obj->otyp == CHALICE) u.webchalices += (int) obj->quan; /* WEB_HOOK_CHALICE2 */\n"
                        "	if (IS_ALTAR(levl[x][y].typ))\n")],
     "WEB_HOOK_CHALICE2")
edit("src/do.c", [("	if (!u.uswallow) {\n	    if (ship_object(obj, u.ux, u.uy, FALSE)) return;\n",
                   "	if (!u.uswallow && obj->otyp == CHALICE && !IS_ALTAR(levl[u.ux][u.uy].typ)) { /* WEB_HOOK_CHALICE2 */\n"
                   "	    pline(\"%s %s!\", The(xname(obj)), otense(obj, \"shatter\"));\n"
                   "	    u.webchalices += (int) obj->quan;\n"
                   "	    obfree(obj, (struct obj *)0);\n"
                   "	    return;\n"
                   "	}\n"
                   "	if (!u.uswallow) {\n	    if (ship_object(obj, u.ux, u.uy, FALSE)) return;\n")],
     "WEB_HOOK_CHALICE2")
# BrickHack: a good prayer (timeout run out, Luck and his favour sound) at
# Jesus's altar by his follower: a holy wafer on the altar (winweb.c
# web_altar_wafer); eaten, it heals, as it ever did a lawful hero. Not to be
# farmed: only a good prayer brings one, and it sets the timeout long again
edit("src/pray.c", [("	if(on_altar())\n	    (void) water_prayer(TRUE);\n	pleased(alignment); /* nice */\n",
                     "	if(on_altar())\n	    (void) water_prayer(TRUE);\n	pleased(alignment); /* nice */\n"
                     "	if (on_altar()) { extern void NDECL(web_altar_wafer); web_altar_wafer(); } /* WEB_HOOK_WAFER */\n")],
     "WEB_HOOK_WAFER")
# BrickHack: the armour a character starts with is its design's own (the
# monk's robe his habit, his gloves his hands): marked (saved with it), never
# merged with any other, and sent as a look of its own (winweb.c
# web_obj_tile: START_TILE), which the client shows as the design's piece
edit("include/obj.h", [("	Bitfield(was_thrown,1); /* thrown by the hero since last picked up */\n",
                        "	Bitfield(was_thrown,1); /* thrown by the hero since last picked up */\n"
                        "	Bitfield(webstart,1);	/* WEB_HOOK_STARTGEAR: armour the hero started with (its design's piece) */\n")],
     "WEB_HOOK_STARTGEAR")
edit("src/u_init.c", [("	/* make sure you can carry all you have - especially for Tourists */\n",
                       "	{ struct obj *o; for (o = invent; o; o = o->nobj) if (o->oclass == ARMOR_CLASS) o->webstart = 1; } /* WEB_HOOK_STARTGEAR */\n"
                       "	/* make sure you can carry all you have - especially for Tourists */\n")],
     "WEB_HOOK_STARTGEAR")
edit("src/invent.c", [("	if (obj->otyp != otmp->otyp) return FALSE;\n",
                       "	if (obj->otyp != otmp->otyp) return FALSE;\n"
                       "	if (obj->webstart != otmp->webstart) return FALSE; /* WEB_HOOK_STARTGEAR */\n")],
     "WEB_HOOK_STARTGEAR")
# Dreamland heroes are blessed with swimming (the lakes are for paddling)
edit("src/u_init.c", [("    { /* WEB_HOOK */ /* NetHack 3D: everyone starts with a pick-axe */",
                       "    if (flags.dreamland) HSwimming |= FROMOUTSIDE; /* WEB_HOOK_DREAM */\n"
                       "    { /* WEB_HOOK */ /* NetHack 3D: everyone starts with a pick-axe */")],
     "WEB_HOOK_DREAM")
# Dreamland's lakes are clear and friendly: swimmers stay on the surface
# (NetHack's swimming is underwater: the map shrinks to the squares around
# you and your scrolls and potions get soaked)
edit("src/trap.c", [("	/* happily wading in the same contiguous pool */",
                     "	if (flags.dreamland && Swimming && u.uz.dnum == 0) { /* WEB_HOOK_SWIM */\n"
                     "	    if (!is_pool(u.ux - u.dx, u.uy - u.dy))\n"
                     "		You(\"splash into the clear water and paddle along.\");\n"
                     "	    u.uinwater = 0;\n"
                     "	    return(FALSE);\n"
                     "	}\n\n"
                     "	/* happily wading in the same contiguous pool */")],
     "WEB_HOOK_SWIM")
# Dreamland's creatures stay in Dreamland: leaving it, only pets come along
edit("src/dog.c", [("	    if (pets_only && !mtmp->mtame) continue;",
                    "	    if (pets_only && !mtmp->mtame) continue;\n"
                    "	    if (flags.dreamland && u.uz.dnum == 0 && u.uz.dlevel == 1 && !mtmp->mtame) continue; /* WEB_HOOK_DREAM */")],
     "WEB_HOOK_DREAM")
# ...and no zapping wands at a hero who's out of reach up high
edit("src/muse.c", [("#include \"hack.h\"\n", "#include \"hack.h\"\nextern int FDECL(web_mon_cant_reach, (struct monst *)); /* WEB_HOOK_REACH */\n"),
                    ("	m.offensive = (struct obj *)0;\n	m.has_offense = 0;\n",
                     "	m.offensive = (struct obj *)0;\n	m.has_offense = 0;\n"
                     "	if (web_mon_cant_reach(mtmp)) return FALSE; /* WEB_HOOK_REACH */\n")],
     "WEB_HOOK_REACH")
# Ascend: the stair in the house you start in goes down and out of the game
edit("src/do.c", [("#include \"hack.h\"\n", "#include \"hack.h\"\nextern int NDECL(web_dream_exit_here); /* WEB_HOOK_EXIT */\n"),
                  ("	if (Role_if(PM_GNOME) && on_level(&mineend_level,&u.uz)) {",
                   "	if (web_dream_exit_here()) { /* WEB_HOOK_EXIT */\n"
                   "		if (yn(\"Beware, there will be no return! Still go down?\") != 'y')\n"
                   "			return(0);\n"
                   "		if (!next_to_u()) {\n"
                   "			You(\"are held back by your pet!\");\n"
                   "			return(0);\n"
                   "		}\n"
                   "		prev_level(TRUE); /* level 0: you leave, as up the Dungeons' first stairs */\n"
                   "		return(1);\n"
                   "	}\n"
                   "	if (Role_if(PM_GNOME) && on_level(&mineend_level,&u.uz)) {"),
                  ("doup()\n{\n",
                   "doup()\n{\n"
                   "	if (web_dream_exit_here()) { /* WEB_HOOK_EXIT: that stair only goes down */\n"
                   "		You_cant(\"go up here.\");\n"
                   "		return(0);\n"
                   "	}\n")],
     "WEB_HOOK_EXIT")
# Dreamland's second level (Ascend: you come up through the portal on the
# first level's tower)
# Dreamland: food heals you, as in Kirby (a melon heals you completely, like a Maxim Tomato)
edit("src/eat.c", [("#include \"hack.h\"\n", "#include \"hack.h\"\nextern void FDECL(web_dream_food, (struct obj *)); /* WEB_HOOK_FOOD */\n"),
                   ("register struct obj *otmp;\n{\n	switch(otmp->otyp) {\n	    case SPRIG_OF_WOLFSBANE:",
                    "register struct obj *otmp;\n{\n	web_dream_food(otmp); /* WEB_HOOK_FOOD */\n"
                    "	switch(otmp->otyp) {\n	    case SPRIG_OF_WOLFSBANE:")],
     "WEB_HOOK_FOOD")
# a monster standing on top of a stack of blocks (put there by a Dreamland
# level) stays up there: it only moves along the tops
edit("src/mon.c", [("extern int FDECL(web_cell_blocked, (int, int)); /* WEB_HOOK */",
                    "extern int FDECL(web_cell_blocked, (int, int)); /* WEB_HOOK */\n"
                    "extern int FDECL(web_mon_step_blocked, (int, int, int, int)); /* WEB_HOOK_UP */"),
                   ("            if (web_cell_blocked(nx, ny)) /* WEB_HOOK */",
                    "            if (web_mon_step_blocked(x, y, nx, ny)) /* WEB_HOOK WEB_HOOK_UP */")],
     "WEB_HOOK_UP")
# Dreamland's palace: offering anything on its altar opens a portal in
# one of the hedge mazes (whatever the gods make of the offering)
edit("src/pray.c", [("#include \"hack.h\"\n", "#include \"hack.h\"\nextern void NDECL(web_dream_sacrifice); /* WEB_HOOK_ALTAR */\n"),
                    ("    if (orac) return (offer_oracle(orac, otmp));",
                     "    web_dream_sacrifice(); /* WEB_HOOK_ALTAR: anything offered */\n"
                     "    if (orac) return (offer_oracle(orac, otmp));")],
     "WEB_HOOK_ALTAR")
# dev cheese: the "Blazing Cheese" armour sets monsters that hit you in melee on fire
edit("src/mhitu.c", [("#include \"hack.h\"\n", "#include \"hack.h\"\nextern int FDECL(web_cheese_burn, (struct monst *)); /* WEB_HOOK_CHEESE */\n"),
                     ("	    if(sum[i] == 2) return 1;		/* attacker dead */",
                      "	    if (sum[i] == 1 && !range2 && web_cheese_burn(mtmp)) return 1; /* WEB_HOOK_CHEESE: burnt up */\n"
                      "	    if(sum[i] == 2) return 1;		/* attacker dead */")],
     "WEB_HOOK_CHEESE")
# MineHack races: dwarves and elves can be any role, of any alignment the
# role allows (they also count as human for the roles' race lists), and two
# new races, for every role too: the Quantum (born of a quantum mechanic:
# teleports at random, from the start) and the Angel (flies, sees invisible)
RACE_ANY = "MH_HUMAN | ROLE_MALE|ROLE_FEMALE | ROLE_LAWFUL|ROLE_NEUTRAL|ROLE_CHAOTIC"
edit("src/role.c", [
    ("	PM_DWARF, NON_PM, PM_DWARF_MUMMY, PM_DWARF_ZOMBIE,\n	MH_DWARF | ROLE_MALE|ROLE_FEMALE | ROLE_LAWFUL,",
     "	PM_DWARF, NON_PM, PM_DWARF_MUMMY, PM_DWARF_ZOMBIE,\n	MH_DWARF | " + RACE_ANY + ", /* WEB_HOOK_RACES: any role */"),
    ("	PM_ELF, NON_PM, PM_ELF_MUMMY, PM_ELF_ZOMBIE,\n	MH_ELF | ROLE_MALE|ROLE_FEMALE | ROLE_LAWFUL|ROLE_NEUTRAL,",
     "	PM_ELF, NON_PM, PM_ELF_MUMMY, PM_ELF_ZOMBIE,\n	MH_ELF | " + RACE_ANY + ", /* WEB_HOOK_RACES: any role */"),
    ("/* Array terminator */\n{ 0, 0, 0, 0 }};",
     "{	\"quantum\", \"quantum\", \"quantumhood\", \"Qua\", /* WEB_HOOK_RACES */\n"
     "	{0, 0},\n"
     "	PM_QUANTUM_MECHANIC, NON_PM, PM_HUMAN_MUMMY, PM_HUMAN_ZOMBIE,\n"
     "	" + RACE_ANY + ",\n"
     "	MH_HUMAN, 0, MH_GNOME|MH_ORC,\n"
     "	/*    Str     Int Wis Dex Con Cha */\n"
     "	{      3,      3,  3,  3,  3,  3 },\n"
     "	{ STR18(100), 20, 18, 20, 18, 18 },\n"
     "	/* Init   Lower  Higher */\n"
     "	{  2, 0,  0, 2,  1, 0 },	/* Hit points */\n"
     "	{  2, 0,  2, 0,  2, 0 }		/* Energy */\n"
     "},\n"
     "{	\"angel\", \"angelic\", \"angelhood\", \"Ang\", /* WEB_HOOK_RACES */\n"
     "	{0, 0},\n"
     "	PM_ANGEL, NON_PM, PM_HUMAN_MUMMY, PM_HUMAN_ZOMBIE,\n"
     "	" + RACE_ANY + ",\n"
     "	MH_HUMAN, 0, MH_ORC,\n"
     "	/*    Str     Int Wis Dex Con Cha */\n"
     "	{      3,      3,  3,  3,  3,  3 },\n"
     "	{ STR18(100), 18, 20, 18, 18, 20 },\n"
     "	/* Init   Lower  Higher */\n"
     "	{  2, 0,  0, 2,  1, 0 },	/* Hit points */\n"
     "	{  3, 0,  3, 0,  3, 0 }		/* Energy */\n"
     "},\n"
     "/* Array terminator */\n{ 0, 0, 0, 0 }};"),
], "WEB_HOOK_RACES")
# Angels are a people of their own, not men with wings: only the holy and
# warrior roles take them (Priest, Knight, Valkyrie, Healer, Undead Slayer,
# Monk, Samurai). Their race group is a bit no other race uses (0x0800, inside
# ROLE_RACEMASK; it's M2_LORD among monster flags, but only the roles' and
# races' allow masks are checked against it).
ANGEL_ROLES = ["Healer", "Knight", "Monk", "Priest", "Samurai", "Undead Slayer", "Valkyrie"]
edit("include/monflag.h", [
    ("#define MH_VAMPIRE	M2_VAMPIRE\n",
     "#define MH_VAMPIRE	M2_VAMPIRE\n#define MH_ANGEL	0x00000800L	/* WEB_HOOK_ANGELS: the roles angels can take */\n"),
], "WEB_HOOK_ANGELS")
_role_c = f"{src}/src/role.c"
_s = open(_role_c, encoding="latin-1").read()
if "WEB_HOOK_ANGELS" not in _s:
    _old = "	PM_ANGEL, NON_PM, PM_HUMAN_MUMMY, PM_HUMAN_ZOMBIE,\n	" + RACE_ANY + ","
    if _old not in _s:
        sys.exit("patch_engine: angel race entry not found in src/role.c")
    _s = _s.replace(_old, "	PM_ANGEL, NON_PM, PM_HUMAN_MUMMY, PM_HUMAN_ZOMBIE,\n"
                    "	MH_ANGEL | ROLE_MALE|ROLE_FEMALE | ROLE_LAWFUL|ROLE_NEUTRAL|ROLE_CHAOTIC, /* WEB_HOOK_ANGELS */", 1)
    _roles_end = _s.index("const struct Race races[]")
    for _name in ANGEL_ROLES:
        _i = _s.index('{"' + _name + '"')
        _j = _s.index("MH_", _i)   # the role's allow mask: its first race group
        if _j > _roles_end:
            sys.exit(f"patch_engine: allow mask of {_name} not found in src/role.c")
        _s = _s[:_j] + "MH_ANGEL|" + _s[_j:]
    open(_role_c, "w", encoding="latin-1").write(_s)

# (an Angel's wings: flying as an intrinsic, which SLASH'EM doesn't have)
edit("include/youprop.h", [
    ("#define EFlying			u.uprops[FLYING].extrinsic\n#ifdef STEED\n# define Flying			(EFlying || is_flyer(youmonst.data) || \\",
     "#define EFlying			u.uprops[FLYING].extrinsic\n#define HFlying			u.uprops[FLYING].intrinsic /* WEB_HOOK_RACES */\n"
     "#ifdef STEED\n# define Flying			(EFlying || HFlying || is_flyer(youmonst.data) || \\"),
    ("# define Flying			(EFlying || is_flyer(youmonst.data))\n",
     "# define Flying			(EFlying || HFlying || is_flyer(youmonst.data))\n"),
], "WEB_HOOK_RACES")
edit("src/attrib.c", [
    ("	dop_abil[] = {",
     "	qua_abil[] = { {   1, &(HTeleportation), \"\", \"\" }, /* WEB_HOOK_RACES: random teleports */\n"
     "		       {   0, 0, 0, 0 } },\n\n"
     "	ang_abil[] = { {   1, &(HFlying), \"\", \"\" }, /* WEB_HOOK_RACES */\n"
     "		       {   1, &(HSee_invisible), \"\", \"\" },\n"
     "		       {   0, 0, 0, 0 } },\n\n"
     "	dop_abil[] = {"),
    ("	case PM_DOPPELGANGER:	rabil = dop_abil;	break;",
     "	case PM_DOPPELGANGER:	rabil = dop_abil;	break;\n"
     "	case PM_QUANTUM_MECHANIC: rabil = qua_abil;	break; /* WEB_HOOK_RACES */\n"
     "	case PM_ANGEL:		rabil = ang_abil;	break;"),
], "WEB_HOOK_RACES")
# Dreamland's levels have no random variants, even where the dungeon happens
# to put one of SLASH'EM's special levels (makemaz would look for
# "dreamln5-2.lev", fail and make a maze instead)
edit("src/mkmaze.c", [
    ("	    if(sp && sp->rndlevs) Sprintf(protofile, \"%s-%d\", s,",
     "	    if(sp && sp->rndlevs && strncmp(s, \"dreamln\", 7)) /* WEB_HOOK_DREAMVARIANT */\n"
     "			 Sprintf(protofile, \"%s-%d\", s,"),
], "WEB_HOOK_DREAMVARIANT")
# the Fountain of Dreams' trial runs once a turn (winweb.c web_dream_waves)
edit("src/allmain.c", [
    ("		    monstermoves++;\n		    moves++;\n",
     "		    monstermoves++;\n		    moves++;\n"
     "		    { extern void NDECL(web_dream_waves); web_dream_waves(); } /* WEB_HOOK_WAVES */\n"),
], "WEB_HOOK_WAVES")
# the Star Rod (the Fountain of Dreams' prize): its beam of stars (winweb.c web_star_rod)
edit("src/zap.c", [
    ("	if (otyp >= SPE_MAGIC_MISSILE && otyp <= SPE_ACID_STREAM)\n		skilldmg = spell_damage_bonus(obj->otyp);",
     "	{ extern int FDECL(web_star_rod, (struct obj *)); if (web_star_rod(obj)) return; } /* WEB_HOOK_STARROD */\n"
     "	if (otyp >= SPE_MAGIC_MISSILE && otyp <= SPE_ACID_STREAM)\n		skilldmg = spell_damage_bonus(obj->otyp);"),
], "WEB_HOOK_STARROD")
# ---- King Skelly III and the Realm Daggers. The king of the underworld
# climbed out of Gehennom with the three Realm Daggers and took the Castle,
# the fortress over hell's gate: he sits on its throne, his undead holding
# its walls. Together the daggers open a portal to any realm you've reached
# (as the Eye of the Aethiopica does); apart, each has a power of its own.
# Beaten down, he tears a portal open and flees through it to another realm,
# a dagger knocked loose as he goes. (The game side is in winweb.c:
# web_realm_*; King Skelly himself is mods/monsters/king-skelly-iii.json.)
edit("include/artifact.h", [
    ("#define OBJ_DETECTION	(LAST_PROP+16)\n",
     "#define OBJ_DETECTION	(LAST_PROP+16)\n#define REALM_DAGGER	(LAST_PROP+17)	/* WEB_HOOK_SKELLY */\n"),
], "WEB_HOOK_SKELLY")
edit("include/artilist.h", [
    ("A(0, 0, 0, 0, 0, NO_ATTK, NO_DFNS, NO_CARY, 0, A_NONE, NON_PM, NON_PM, 0L )",
     "/* WEB_HOOK_SKELLY: the Realm Daggers, King Skelly III's */\n"
     "A(\"The Dagger of Creation\",	GREAT_DAGGER,\n"
     "	(SPFX_NOGEN|SPFX_RESTR|SPFX_INTEL|SPFX_ATTK|SPFX_REGEN), 0, 0,\n"
     "	COLD(5,8),	NO_DFNS,	NO_CARY,\n"
     "	REALM_DAGGER,	A_NONE, NON_PM, NON_PM, 6000L ),\n\n"
     "A(\"The Dagger of Protection\",	GREAT_DAGGER,\n"
     "	(SPFX_NOGEN|SPFX_RESTR|SPFX_INTEL|SPFX_REFLECT|SPFX_HPHDAM), 0, 0,\n"
     "	PHYS(5,4),	DFNS(AD_DRLI),	NO_CARY,\n"
     "	REALM_DAGGER,	A_NONE, NON_PM, NON_PM, 6000L ),\n\n"
     "A(\"The Dagger of Destruction\",	GREAT_DAGGER,\n"
     "	(SPFX_NOGEN|SPFX_RESTR|SPFX_INTEL|SPFX_ATTK), 0, 0,\n"
     "	FIRE(5,12),	NO_DFNS,	NO_CARY,\n"
     "	REALM_DAGGER,	A_NONE, NON_PM, NON_PM, 6000L ),\n\n"
     "A(0, 0, 0, 0, 0, NO_ATTK, NO_DFNS, NO_CARY, 0, A_NONE, NON_PM, NON_PM, 0L )"),
], "WEB_HOOK_SKELLY")
edit("src/artifact.c", [
    ("#include \"hack.h\"\n",
     "#include \"hack.h\"\nextern int NDECL(web_realm_set); /* WEB_HOOK_SKELLY */\nextern void FDECL(web_realm_power, (struct obj *));\n"),
    ("	case CREATE_PORTAL: {\n",
     "	case REALM_DAGGER: /* WEB_HOOK_SKELLY: apart, each its own power... */\n"
     "	    if (!web_realm_set()) {\n"
     "		web_realm_power(obj);\n"
     "		break;\n"
     "	    }\n"
     "	    pline_The(\"three Realm Daggers blaze blue, green and red as one!\");\n"
     "	    /* ...together, a portal to any realm you've reached: */\n"
     "	    /* FALLTHRU */\n"
     "	case CREATE_PORTAL: {\n"),
], "WEB_HOOK_SKELLY")
edit("src/makemon.c", [
    ("#include \"hack.h\"\n", "#include \"hack.h\"\nextern void FDECL(web_monster_gear, (struct monst *)); /* WEB_HOOK_SKELLY */\n"),
    ("	    m_initinv(mtmp);  /* add on a few special items incl. more armor */\n",
     "	    m_initinv(mtmp);  /* add on a few special items incl. more armor */\n"
     "	    web_monster_gear(mtmp); /* WEB_HOOK_SKELLY: King Skelly's daggers */\n"),
], "WEB_HOOK_SKELLY")
edit("src/monmove.c", [
    ("#include \"hack.h\"\n", "#include \"hack.h\"\nextern int FDECL(web_realm_turn, (struct monst *)); /* WEB_HOOK_SKELLY */\n"),
    ("	/* check for waitmask status change */\n	if ((mtmp->mstrategy & STRAT_WAITFORU) &&",
     "	if (web_realm_turn(mtmp)) /* WEB_HOOK_SKELLY: King Skelly fled through a portal */\n"
     "	    return 1;\n\n"
     "	/* check for waitmask status change */\n	if ((mtmp->mstrategy & STRAT_WAITFORU) &&"),
], "WEB_HOOK_SKELLY")
# (his portal is one-way: arriving through a portal with none on the far
# side, you land anywhere on the level, as a level teleport would put you)
edit("src/do.c", [
    ("	    if (!ttrap) panic(\"goto_level: no corresponding portal!\");\n"
     "	    seetrap(ttrap);\n"
     "	    u_on_newpos(ttrap->tx, ttrap->ty);\n",
     "	    if (!ttrap) /* WEB_HOOK_SKELLY: a one-way portal (King Skelly's) */\n"
     "		place_lregion(dndest.lx, dndest.ly, dndest.hx, dndest.hy,\n"
     "			      dndest.nlx, dndest.nly, dndest.nhx, dndest.nhy,\n"
     "			      LR_DOWNTELE, (d_level *) 0);\n"
     "	    else {\n"
     "		seetrap(ttrap);\n"
     "		u_on_newpos(ttrap->tx, ttrap->ty);\n"
     "	    }\n"),
], "WEB_HOOK_SKELLY")
# the Castle, his: skeletons on the walls, the barracks crypts, and in the
# throne room the king on his throne, four loyal skeletons about it, an
# arch-lich and a master lich at court (instead of a court of random monsters).
# (castle.des holds only these changes: start from SLASH'EM's own each build)
_sp.run(["git", "-C", src, "checkout", "--", "dat/castle.des"], check=True)
_castle = f"{src}/dat/castle.des"
_s = open(_castle, encoding="latin-1").read()
for _a, _b in (
    ("MONSTER:'@',\"lieutenant\",(09,08)", "MONSTER:'V',\"vampire lord\",(09,08)"),
    ("REGION:(16,05,25,06),lit,\"barracks\"", "REGION:(16,05,25,06),lit,\"morgue\""),
    ("REGION:(16,10,25,11),lit,\"barracks\"", "REGION:(16,10,25,11),lit,\"morgue\""),
    ("# The throne room and the court monsters\n",
     "# The throne room and the court monsters (WEB_HOOK_SKELLY: King Skelly III's)\n"
     "MONSTER:'Z',\"King Skelly III\",(36,08),hostile\n"
     "MONSTER:'Z',\"skeleton\",(35,07),hostile\n"
     "MONSTER:'Z',\"skeleton\",(35,09),hostile\n"
     "MONSTER:'Z',\"skeleton\",(37,07),hostile\n"
     "MONSTER:'Z',\"skeleton\",(37,09),hostile\n"
     "MONSTER:'L',\"arch-lich\",(32,06),hostile\n"
     "MONSTER:'L',\"master lich\",(32,10),hostile\n"),
):
    if _a not in _s:
        sys.exit(f"patch_engine: anchor not found in dat/castle.des: {_a[:60]}")
    _s = _s.replace(_a, _b, 1)
_s, _n = re.subn(r"MONSTER:'@',\"soldier\",", "MONSTER:'Z',\"skeleton\",", _s)
if _n != 16:
    sys.exit(f"patch_engine: expected 16 soldiers in dat/castle.des, found {_n}")
_s, _n = re.subn(r"MONSTER:monster\[\d\],random,\(\d+,\d+\)\n", "", _s)   # (the random court)
if _n != 27:
    sys.exit(f"patch_engine: expected 27 court monsters in dat/castle.des, found {_n}")
open(_castle, "w", encoding="latin-1").write(_s)
# ---- Narsil, the Sword that was Broken: Elendil's long sword, lawful, bane
# of Sauron's orcs (as Orcrist is); and Glamdring, Gandalf's Foe-hammer, bane
# of orcs and demons. They turn up as artifacts do. (Their LEGO looks: the
# LotR swords, web/assets/lego/items.json.)
edit("include/artilist.h", [
    ("A(0, 0, 0, 0, 0, NO_ATTK, NO_DFNS, NO_CARY, 0, A_NONE, NON_PM, NON_PM, 0L )",
     "/* WEB_HOOK_NARSIL: the Sword that was Broken */\n"
     "A(\"Narsil\",			LONG_SWORD,\n"
     "	(SPFX_RESTR|SPFX_DFLAG2), 0, M2_ORC,\n"
     "	PHYS(5,0),	NO_DFNS,	NO_CARY,	0, A_LAWFUL, NON_PM, NON_PM, 2500L ),\n\n"
     "/* Glamdring, Foe-hammer: Gandalf's, bane of orcs and of demons (the Balrog) */\n"
     "A(\"Glamdring\",		ELVEN_BROADSWORD,\n"
     "	(SPFX_RESTR|SPFX_DFLAG2), 0, (M2_ORC|M2_DEMON),\n"
     "	PHYS(5,0),	NO_DFNS,	NO_CARY,	0, A_NEUTRAL, NON_PM, NON_PM, 2500L ),\n\n"
     "A(0, 0, 0, 0, 0, NO_ATTK, NO_DFNS, NO_CARY, 0, A_NONE, NON_PM, NON_PM, 0L )"),
], "WEB_HOOK_NARSIL")
# ---- The four golden weapons of Spinjitzu (Ninjago): never found in the
# dungeon (the dev command "give <name>" hands them over: winweb.c), each with
# its element on its blows and, invoked, its power (winweb.c web_golden_power):
# the Scythe of Quakes shakes the ground, the Nunchucks of Lightning, the
# Shurikens of Ice and the Sword of Fire each loose a ray of their element.
edit("include/artifact.h", [
    ("#define REALM_DAGGER	(LAST_PROP+17)	/* WEB_HOOK_SKELLY */\n",
     "#define REALM_DAGGER	(LAST_PROP+17)	/* WEB_HOOK_SKELLY */\n"
     "#define SPINJITZU	(LAST_PROP+18)	/* WEB_HOOK_SPINJITZU */\n"),
], "WEB_HOOK_SPINJITZU")
edit("include/artilist.h", [
    ("A(0, 0, 0, 0, 0, NO_ATTK, NO_DFNS, NO_CARY, 0, A_NONE, NON_PM, NON_PM, 0L )",
     "/* WEB_HOOK_SPINJITZU: the four golden weapons of Spinjitzu */\n"
     "A(\"The Scythe of Quakes\",	FAUCHARD,\n"
     "	(SPFX_NOGEN|SPFX_RESTR|SPFX_ATTK), 0, 0,\n"
     "	STUN(5,8),	NO_DFNS,	NO_CARY,	SPINJITZU, A_NONE, NON_PM, NON_PM, 4000L ),\n\n"
     "A(\"The Nunchucks of Lightning\",	FLAIL,\n"
     "	(SPFX_NOGEN|SPFX_RESTR|SPFX_ATTK), 0, 0,\n"
     "	ELEC(5,10),	NO_DFNS,	NO_CARY,	SPINJITZU, A_NONE, NON_PM, NON_PM, 4000L ),\n\n"
     "A(\"The Shurikens of Ice\",	SHURIKEN,\n"
     "	(SPFX_NOGEN|SPFX_RESTR|SPFX_ATTK), 0, 0,\n"
     "	COLD(5,10),	NO_DFNS,	NO_CARY,	SPINJITZU, A_NONE, NON_PM, NON_PM, 4000L ),\n\n"
     "A(\"The Sword of Fire\",	KATANA,\n"
     "	(SPFX_NOGEN|SPFX_RESTR|SPFX_ATTK), 0, 0,\n"
     "	FIRE(5,10),	NO_DFNS,	NO_CARY,	SPINJITZU, A_NONE, NON_PM, NON_PM, 4000L ),\n\n"
     "A(0, 0, 0, 0, 0, NO_ATTK, NO_DFNS, NO_CARY, 0, A_NONE, NON_PM, NON_PM, 0L )"),
], "WEB_HOOK_SPINJITZU")
edit("src/artifact.c", [
    ("extern void FDECL(web_realm_power, (struct obj *));\n",
     "extern void FDECL(web_realm_power, (struct obj *));\nextern void FDECL(web_golden_power, (struct obj *)); /* WEB_HOOK_SPINJITZU */\n"),
    ("	case REALM_DAGGER: /* WEB_HOOK_SKELLY: apart, each its own power... */\n",
     "	case SPINJITZU: /* WEB_HOOK_SPINJITZU: a golden weapon's power */\n"
     "	    web_golden_power(obj);\n"
     "	    break;\n"
     "	case REALM_DAGGER: /* WEB_HOOK_SKELLY: apart, each its own power... */\n"),
], "WEB_HOOK_SPINJITZU")
# ---- Tiles follow appearances: SLASH'EM reshuffles its tile table to match
# each game's shuffled appearances (o_init.c shuffle_tiles) only for its own
# tile front ends (USE_TILES); without it the web port sends every potion,
# scroll, ring, wand, helm... with its true item's tile, giving it away
edit("include/global.h", [
    ("#if defined(GL_GRAPHICS) || defined(SDL_GRAPHICS)\n",
     "#if defined(GL_GRAPHICS) || defined(SDL_GRAPHICS) || defined(WEB_GRAPHICS) /* WEB_HOOK_TILES */\n"),
], "WEB_HOOK_TILES")
print("engine hooks applied:", src)
