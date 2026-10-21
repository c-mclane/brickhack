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

# ---- Ascend: its own start level (a blank baseplate) and its own story
edit("include/flag.h", [("	boolean  legacy;	/* print game entry \"story\" */",
                         "	boolean  legacy;	/* print game entry \"story\" */\n	boolean  dreamland;	/* BrickHack: start in Ascend's level; WEB_HOOK_DREAM */")],
     "WEB_HOOK_DREAM")
edit("src/options.c", [('	{"legacy", &flags.legacy, TRUE, DISP_IN_GAME},',
                        '	{"legacy", &flags.legacy, TRUE, DISP_IN_GAME},\n	{"dreamland", &flags.dreamland, FALSE, SET_IN_FILE}, /* WEB_HOOK_DREAM */')],
     "WEB_HOOK_DREAM")
# the first level of the Dungeons of Doom is Ascend's level
# (mklev.c holds only Ascend's hook: start from SLASH'EM's own copy each
# build, so the hook can change)
import subprocess as _sp
_sp.run(["git", "-C", src, "checkout", "--", "src/mklev.c"], check=True)
# Ascend's level: level 1 of the first dungeon is "dreamlnd", up to
# DREAM_LEVELS (1: dreamlnd.h, from tools/dreamland_gen.py)
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
# (the server's BRICKHACK_KIT, from the design: a Catholic priest's hosts;
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
# figure's kit, BRICKHACK_KIT): a potion in a golden goblet, never made at random
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

rename("src/role.c", [("\"brick" "HACK_", "\"BRICK" "HACK_")])
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
# BrickHack: a figure's own deity (the server's BRICKHACK_GOD, from its design:
# Jesus, for the Catholic priest, the monastic orders and the crusading
# knights), the lawful god (its followers are lawful: the server sets
# align:lawful); set again on every restore
edit("src/role.c", [("	    urole.cgod = roles[flags.pantheon].cgod;\n	}\n",
                     "	    urole.cgod = roles[flags.pantheon].cgod;\n	}\n"
                     "	{ /* WEB_HOOK_GOD */\n"
                     "	    static char web_god[64];\n"
                     "	    const char *g = getenv(\"BRICKHACK_GOD\");\n"
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
edit("src/pray.c", [("    if (orac) return (offer_oracle(orac, otmp));\n",
                     "    if (!orac) { extern int FDECL(web_offer, (struct obj *)); if (web_offer(otmp)) return 1; } /* WEB_HOOK_RITES */\n"
                     "    if (orac) return (offer_oracle(orac, otmp));\n")],
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
# BrickHack: thrown things fly in the client's physics: the hero's throw is sent
# as an event (winweb.c web_throw: what, from, to), its flight not painted
# square by square on the map (web_freeze_map: the engine restores every square
# it paints, so nothing is lost); anything that breaks is sent too (web_shatter)
edit("src/dothrow.c", [("#include \"hack.h\"\n",
                        "#include \"hack.h\"\n"
                        "extern int web_freeze_map; /* WEB_HOOK_THROW */\n"
                        "extern void FDECL(web_throw, (struct obj *, int, int, BOOLEAN_P));\n"
                        "extern void FDECL(web_shatter, (struct obj *, int, int));\n"),
                       ("		mon = bhit(u.dx,u.dy,range,THROWN_WEAPON,\n",
                        "		web_freeze_map++; /* WEB_HOOK_THROW: the client flies it */\n"
                        "		mon = bhit(u.dx,u.dy,range,THROWN_WEAPON,\n"),
                       ("			   &obj);\n\n		/* have to do this after bhit() so u.ux & u.uy are correct */\n",
                        "			   &obj);\n"
                        "		web_freeze_map--;\n"
                        "		if (obj) web_throw(obj, bhitpos.x, bhitpos.y, mon != 0);\n"
                        "\n		/* have to do this after bhit() so u.ux & u.uy are correct */\n"),
                       ("		    tmp_at(DISP_FLASH, obj_to_glyph(obj));\n		    tmp_at(bhitpos.x, bhitpos.y);\n		    delay_output();\n		    tmp_at(DISP_END, 0);\n		    breakmsg(obj, cansee(bhitpos.x, bhitpos.y));\n",
                        "		    web_freeze_map++;\n"
                        "		    tmp_at(DISP_FLASH, obj_to_glyph(obj));\n		    tmp_at(bhitpos.x, bhitpos.y);\n		    delay_output();\n		    tmp_at(DISP_END, 0);\n"
                        "		    web_freeze_map--;\n"
                        "		    breakmsg(obj, cansee(bhitpos.x, bhitpos.y));\n"),
                       ("	if (obj->otyp == CHALICE) u.webchalices += (int) obj->quan; /* WEB_HOOK_CHALICE2 */\n",
                        "	if (obj->otyp == CHALICE) u.webchalices += (int) obj->quan; /* WEB_HOOK_CHALICE2 */\n"
                        "	web_shatter(obj, x, y); /* WEB_HOOK_THROW: shards */\n")],
     "WEB_HOOK_THROW")
# ...and a potion that breaks over someone (potionhit: thrown at a monster, or
# at you) shatters too: shards and a splash
edit("src/potion.c", [("	boolean isyou = (mon == &youmonst);\n	int distance;\n\n	if(isyou) {\n",
                       "	boolean isyou = (mon == &youmonst);\n	int distance;\n\n"
                       "	{ extern void FDECL(web_shatter, (struct obj *, int, int)); /* WEB_HOOK_SPLASH */\n"
                       "	  web_shatter(obj, isyou ? u.ux : mon->mx, isyou ? u.uy : mon->my); }\n"
                       "	if(isyou) {\n")],
     "WEB_HOOK_SPLASH")
# ...and a monster's throw flies in the client's physics too (winweb.c
# web_mthrow_begin/end: what, from the monster to where it stopped; the flight
# not painted square by square)
edit("src/mthrowu.c", [("	if (sym) tmp_at(DISP_FLASH, obj_to_glyph(singleobj));\n",
                        "	{ extern void FDECL(web_mthrow_begin, (struct obj *, int, int)); web_mthrow_begin(singleobj, x, y); } /* WEB_HOOK_MTHROW */\n"
                        "	if (sym) tmp_at(DISP_FLASH, obj_to_glyph(singleobj));\n"),
                       ("	tmp_at(bhitpos.x, bhitpos.y);\n	delay_output();\n	tmp_at(DISP_END, 0);\n\n	if (blindinc) {\n",
                        "	tmp_at(bhitpos.x, bhitpos.y);\n	delay_output();\n	tmp_at(DISP_END, 0);\n"
                        "	{ extern void FDECL(web_mthrow_end, (int, int)); web_mthrow_end(bhitpos.x, bhitpos.y); } /* WEB_HOOK_MTHROW */\n"
                        "\n	if (blindinc) {\n")],
     "WEB_HOOK_MTHROW")
# BrickHack: boulders roll in the client's physics: a push is sent as an event
# (winweb.c web_boulder_push: from, to), the boulder rolling and tumbling into
# the next square; a boulder broken into rocks is sent too (web_boulder_break),
# to burst into grit and rocks
edit("src/hack.c", [("	    /* Move the boulder *after* the message. */\n",
                     "	    /* Move the boulder *after* the message. */\n"
                     "	    { extern void FDECL(web_boulder_push, (struct obj *, int, int, int, int)); /* WEB_HOOK_BOULDER */\n"
                     "	      web_boulder_push(otmp, sx, sy, rx, ry); }\n")],
     "WEB_HOOK_BOULDER")
edit("src/zap.c", [("	if (obj->otyp == BOULDER && In_sokoban(&u.uz) && !flags.mon_moving)\n	    change_luck(-1);\n",
                    "	if (obj->otyp == BOULDER && In_sokoban(&u.uz) && !flags.mon_moving)\n	    change_luck(-1);\n"
                    "	if (obj->otyp == BOULDER) { extern void FDECL(web_boulder_break, (struct obj *)); web_boulder_break(obj); } /* WEB_HOOK_BOULDER */\n")],
     "WEB_HOOK_BOULDER")
# ---- The One Ring: Sauron's, a ring of invisibility, never made at random (for
# now it turns up nowhere: the dev command "give The One Ring"). Its burden is
# crushing (inv_weight): whoever carries it can't move, unless a hobbit (the
# Ring's bearers). Its brick look: the One Ring in chrome gold (items.json "One Ring")
edit("include/artilist.h", [
    ("A(0, 0, 0, 0, 0, NO_ATTK, NO_DFNS, NO_CARY, 0, A_NONE, NON_PM, NON_PM, 0L )",
     "/* WEB_HOOK_ONERING: the One Ring, to rule them all */\n"
     "A(\"The One Ring\",		RIN_INVISIBILITY,\n"
     "	(SPFX_NOGEN|SPFX_RESTR), 0, 0,\n"
     "	NO_ATTK,	NO_DFNS,	NO_CARY,	0, A_CHAOTIC, NON_PM, NON_PM, 5000L ),\n\n"
     "A(0, 0, 0, 0, 0, NO_ATTK, NO_DFNS, NO_CARY, 0, A_NONE, NON_PM, NON_PM, 0L )"),
], "WEB_HOOK_ONERING")
edit("src/hack.c", [("			wt += otmp->owt;\n		otmp = otmp->nobj;\n",
                     "			wt += otmp->owt;\n"
                     "		if (otmp->oartifact == ART_ONE_RING && !Race_if(PM_HOBBIT)) /* WEB_HOOK_ONERING */\n"
                     "			wt += 5000;	/* (its burden: none but a hobbit can move under it) */\n"
                     "		otmp = otmp->nobj;\n")],
     "WEB_HOOK_ONERING")
# ...and no zapping wands at a hero who's out of reach up high
edit("src/muse.c", [("#include \"hack.h\"\n", "#include \"hack.h\"\nextern int FDECL(web_mon_cant_reach, (struct monst *)); /* WEB_HOOK_REACH */\n"),
                    ("	m.offensive = (struct obj *)0;\n	m.has_offense = 0;\n",
                     "	m.offensive = (struct obj *)0;\n	m.has_offense = 0;\n"
                     "	if (web_mon_cant_reach(mtmp)) return FALSE; /* WEB_HOOK_REACH */\n")],
     "WEB_HOOK_REACH")
# a monster standing on top of a stack of blocks stays up there: it only
# moves along the tops
edit("src/mon.c", [("extern int FDECL(web_cell_blocked, (int, int)); /* WEB_HOOK */",
                    "extern int FDECL(web_cell_blocked, (int, int)); /* WEB_HOOK */\n"
                    "extern int FDECL(web_mon_step_blocked, (int, int, int, int)); /* WEB_HOOK_UP */"),
                   ("            if (web_cell_blocked(nx, ny)) /* WEB_HOOK */",
                    "            if (web_mon_step_blocked(x, y, nx, ny)) /* WEB_HOOK WEB_HOOK_UP */")],
     "WEB_HOOK_UP")
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
# of orcs and demons. They turn up as artifacts do. (Their brick looks: the
# LotR swords, web/assets/brick/items.json.)
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
# ---- The four golden weapons of Spinjitzu (ninja): never found in the
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
# BrickHack: which of your things #invoke does something (an artifact with a
# power): the inventory marks them (winweb.c build_inventory), so the client
# offers Invoke on them
edit("src/artifact.c", [
    ("int\ndoinvoke()\n",
     "int\nweb_invokable(obj) /* WEB_HOOK_INVOKE */\nstruct obj *obj;\n{\n"
     "    return get_artifact(obj) && get_artifact(obj)->inv_prop;\n}\n\n"
     "int\ndoinvoke()\n"),
], "WEB_HOOK_INVOKE")
# ---- Tiles follow appearances: SLASH'EM reshuffles its tile table to match
# each game's shuffled appearances (o_init.c shuffle_tiles) only for its own
# tile front ends (USE_TILES); without it the web port sends every potion,
# scroll, ring, wand, helm... with its true item's tile, giving it away
edit("include/global.h", [
    ("#if defined(GL_GRAPHICS) || defined(SDL_GRAPHICS)\n",
     "#if defined(GL_GRAPHICS) || defined(SDL_GRAPHICS) || defined(WEB_GRAPHICS) /* WEB_HOOK_TILES */\n"),
], "WEB_HOOK_TILES")
# BrickHack: a fountain drunk from or dipped into: sent as an event (winweb.c
# web_fountain: which, what's dipped, where), the hero drawn kneeling at its
# water, cupping a drink or dipping the thing in (the client plays it)
edit("src/fountain.c", [
    ("#include \"hack.h\"\n",
     "#include \"hack.h\"\nextern void FDECL(web_fountain, (int, struct obj *)); /* WEB_HOOK_FOUNTAIN */\n"),
    ("	if (Levitation) {\n		floating_above(\"fountain\");\n		return;\n	}\n\n	if (mgkftn",
     "	if (Levitation) {\n		floating_above(\"fountain\");\n		return;\n	}\n"
     "	web_fountain(0, (struct obj *) 0);\n\n	if (mgkftn"),
    ("	if (Levitation) {\n		floating_above(\"fountain\");\n		return;\n	}\n\n	/* Don't grant Excalibur",
     "	if (Levitation) {\n		floating_above(\"fountain\");\n		return;\n	}\n"
     "	web_fountain(1, obj);\n\n	/* Don't grant Excalibur"),
], "WEB_HOOK_FOUNTAIN")
# ...and a magic fountain found out (its magic drunk: the wisp of vapor; or one wished for in wizard
# mode): its water flares up, and an aura round it (web_fountain 2); and "the water glows for a moment"
# (dipping: something uncursed) flares the same (web_fountain 3)
edit("src/fountain.c", [
    ("		pline(\"A wisp of vapor escapes the fountain...\");\n",
     "		web_fountain(2, (struct obj *) 0); /* WEB_HOOK_MAGICFTN */\n"
     "		pline(\"A wisp of vapor escapes the fountain...\");\n"),
    ("			    if (!Blind)\n				pline_The(\"water glows for a moment.\");\n",
     "			    if (!Blind) {\n				web_fountain(3, obj); /* WEB_HOOK_MAGICFTN */\n"
     "				pline_The(\"water glows for a moment.\");\n			    }\n"),
    ("			    if (!Blind)\n				pline_The(\"water glows for a moment.\");\n",
     "			    if (!Blind) {\n				web_fountain(3, obj); /* WEB_HOOK_MAGICFTN */\n"
     "				pline_The(\"water glows for a moment.\");\n			    }\n"),
], "WEB_HOOK_MAGICFTN")
edit("src/objnam.c", [
    ("			pline(\"A %sfountain.\",\n			      levl[u.ux][u.uy].blessedftn ? \"magic \" : \"\");\n			newsym(u.ux, u.uy);\n",
     "			pline(\"A %sfountain.\",\n			      levl[u.ux][u.uy].blessedftn ? \"magic \" : \"\");\n			newsym(u.ux, u.uy);\n"
     "			{ extern void FDECL(web_fountain, (int, struct obj *)); /* WEB_HOOK_MAGICFTN */\n"
     "			  if (levl[u.ux][u.uy].blessedftn) web_fountain(2, (struct obj *) 0); }\n"),
], "WEB_HOOK_MAGICFTN")
# BrickHack: falling into water and crawling out (trap.c drown): sent as events (winweb.c web_swim:
# which, from where you stepped or to where you crawl), the client plays them: a stumble in with a splash,
# sinking, then hauling yourself out onto the dry square, dripping (what you dump to lighten up just
# sinks: nothing in water is ever drawn)
edit("src/trap.c", [
    ("#include \"hack.h\"\n",
     "#include \"hack.h\"\nextern void FDECL(web_swim, (int, int, int)); /* WEB_HOOK_SWIM */\n"),
    ("	if (!u.uinwater) {\n	    You(\"%s into the %swater%c\",\n",
     "	if (!u.uinwater) {\n	    web_swim(0, u.ux - u.dx, u.uy - u.dy);\n	    You(\"%s into the %swater%c\",\n"),
    ("			pline(\"Pheew!  That was close.\");\n			teleds(x,y,TRUE);\n",
     "			pline(\"Pheew!  That was close.\");\n			web_swim(1, x, y);\n			teleds(x,y,TRUE);\n"),
], "WEB_HOOK_SWIM")
# BrickHack: a fountain dried up (fountain.c dryup): sent as an event (winweb.c web_dryup: where), the
# client plays it: its water going grey, a moment, and it coming apart brick by brick
edit("src/fountain.c", [
    ("		/* replace the fountain with ordinary floor */\n",
     "		{ extern void FDECL(web_dryup, (int, int)); web_dryup(x, y); } /* WEB_HOOK_DRYUP */\n"
     "		/* replace the fountain with ordinary floor */\n"),
], "WEB_HOOK_DRYUP")
# BrickHack: a fountain gushing (fountain.c dogushforth / gush): sent as events (winweb.c web_gush: from
# where, and each square it floods), the client plays it: a burst of water out of its top, and a stream
# arcing out to each square it floods, the pool there opening as it lands
edit("src/fountain.c", [
    ("	int madepool = 0;\n\n	do_clear_area(u.ux, u.uy, 7, gush, (genericptr_t)&madepool);\n",
     "	int madepool = 0;\n\n"
     "	{ extern void FDECL(web_gush, (int, int)); web_gush(-1, -1); } /* WEB_HOOK_GUSH: the burst */\n"
     "	do_clear_area(u.ux, u.uy, 7, gush, (genericptr_t)&madepool);\n"),
    ("	/* Put a pool at x, y */\n",
     "	{ extern void FDECL(web_gush, (int, int)); web_gush(x, y); } /* WEB_HOOK_GUSH: a pool there */\n"
     "	/* Put a pool at x, y */\n"),
], "WEB_HOOK_GUSH")
# BrickHack: a boulder into water (do.c boulder_hits_pool): sent as an event (winweb.c web_boulder_sink:
# what, from where (pushed) to where, and whether it fills it), the client rolls it in and sinks it, a
# floor rising in its place should it fill the water
edit("src/do.c", [
    ("	    fills_up = lava ? chance == 0 : chance != 0;\n",
     "	    fills_up = lava ? chance == 0 : chance != 0;\n"
     "	    { extern void FDECL(web_boulder_sink, (struct obj *, int, int, BOOLEAN_P, BOOLEAN_P)); /* WEB_HOOK_SINK */\n"
     "	      web_boulder_sink(otmp, rx, ry, fills_up, pushing); }\n"),
], "WEB_HOOK_SINK")
# BrickHack: the Lady of the Lake (fountain.c dipfountain: a long sword dipped, Excalibur): sent as an event
# (winweb.c web_lady: whether she blesses it, or a freezing mist rises), the client plays it as a cutscene: her
# arm rising out of the water to the sword, the blessing, and the fountain going
edit("src/fountain.c", [
    ("		if (u.ualign.type != A_LAWFUL) {\n			/* Ha!  Trying to cheat her. */\n",
     "		{ extern void FDECL(web_lady, (BOOLEAN_P)); web_lady(u.ualign.type == A_LAWFUL); } /* WEB_HOOK_LADY */\n"
     "		if (u.ualign.type != A_LAWFUL) {\n			/* Ha!  Trying to cheat her. */\n"),
], "WEB_HOOK_LADY")
# BrickHack: monsters out of a fountain (fountain.c dowatersnakes: "an endless stream of snakes pours
# forth"): each sent as it's made (winweb.c web_rise: which, and the fountain it came out of), the client
# has it rise up out of the water, over the rim and off to where it is
edit("src/fountain.c", [
    ("	    if((mtmp = makemon(&mons[PM_WATER_MOCCASIN],\n			u.ux, u.uy, NO_MM_FLAGS)) && t_at(mtmp->mx, mtmp->my))\n",
     "	    if((mtmp = makemon(&mons[PM_WATER_MOCCASIN],\n			u.ux, u.uy, NO_MM_FLAGS)) && (web_rise(mtmp), 1) /* WEB_HOOK_RISE */ && t_at(mtmp->mx, mtmp->my))\n"),
    ("#include \"hack.h\"\nextern void FDECL(web_fountain, (int, struct obj *)); /* WEB_HOOK_FOUNTAIN */\n",
     "#include \"hack.h\"\nextern void FDECL(web_fountain, (int, struct obj *)); /* WEB_HOOK_FOUNTAIN */\n"
     "extern void FDECL(web_rise, (struct monst *)); /* WEB_HOOK_RISE */\n"),
], "WEB_HOOK_RISE")
# BrickHack: more out of a fountain (fountain.c): the water demon and the water nymph rise out of it as the
# snakes do (web_rise); a demon granting a wish vanishes in a burst (web_wished); no nymph, and a great bubble
# rises and pops (web_bubble); a gem found in its water leaps out of it (web_gem); and a fire ray across it
# (zap.c) sends up steam (web_steam)
edit("src/fountain.c", [
    ("	if((mtmp = makemon(&mons[PM_WATER_DEMON],u.ux,u.uy, NO_MM_FLAGS))) {\n",
     "	if((mtmp = makemon(&mons[PM_WATER_DEMON],u.ux,u.uy, NO_MM_FLAGS))) {\n"
     "	    web_rise(mtmp); /* WEB_HOOK_FOUNTMORE */\n"),
    ("		makewish();\n		mongone(mtmp);\n",
     "		{ extern void FDECL(web_wished, (struct monst *)); web_wished(mtmp); }\n		makewish();\n		mongone(mtmp);\n"),
    ("	   (mtmp = makemon(&mons[PM_WATER_NYMPH],u.ux,u.uy, NO_MM_FLAGS))) {\n",
     "	   (mtmp = makemon(&mons[PM_WATER_NYMPH],u.ux,u.uy, NO_MM_FLAGS))) {\n"
     "		web_rise(mtmp);\n"),
    ("		if (!Blind)\n		   pline(\"A large bubble rises to the surface and pops.\");\n",
     "		{ extern void NDECL(web_bubble); web_bubble(); }\n"
     "		if (!Blind)\n		   pline(\"A large bubble rises to the surface and pops.\");\n"),
    ("	(void) mksobj_at(rnd_class(DILITHIUM_CRYSTAL, LUCKSTONE-1),\n			 u.ux, u.uy, FALSE, FALSE);\n",
     "	{ extern void FDECL(web_gem, (struct obj *));\n"
     "	  web_gem(mksobj_at(rnd_class(DILITHIUM_CRYSTAL, LUCKSTONE-1),\n			 u.ux, u.uy, FALSE, FALSE)); }\n"),
], "WEB_HOOK_FOUNTMORE")
edit("src/zap.c", [
    ("		    if (cansee(x,y))\n			pline(\"Steam billows from the fountain.\");\n",
     "		    { extern void FDECL(web_steam, (int, int)); web_steam(x, y); } /* WEB_HOOK_STEAM */\n"
     "		    if (cansee(x,y))\n			pline(\"Steam billows from the fountain.\");\n"),
], "WEB_HOOK_STEAM")
# ...and into lava (trap.c lava_effects): falling in, as into water (web_swim: the client knows it's lava by
# the square), its glowing studs flying, smoking
edit("src/trap.c", [
    ("	} else\n	    You(\"fall into the lava!\");\n",
     "	} else {\n	    web_swim(0, u.ux - u.dx, u.uy - u.dy); /* WEB_HOOK_LAVA */\n	    You(\"fall into the lava!\");\n	}\n"),
    ("	You(\"sink into the lava, but it only burns slightly!\");\n",
     "	web_swim(0, u.ux - u.dx, u.uy - u.dy); /* WEB_HOOK_LAVA */\n	You(\"sink into the lava, but it only burns slightly!\");\n"),
], "WEB_HOOK_LAVA")
# BrickHack: a fountain in town used once too often (fountain.c dryup): a watchman seeing it yells at you
# (web_warn: which: he raises his halberd at you); none seeing it, the flow reduces to a trickle (web_trickle:
# the water out of its top thinning)
edit("src/fountain.c", [
    ("				verbalize(\"Hey, stop using that fountain!\");\n",
     "				{ extern void FDECL(web_warn, (struct monst *)); web_warn(mtmp); } /* WEB_HOOK_WARN */\n"
     "				verbalize(\"Hey, stop using that fountain!\");\n"),
    ("			if(!mtmp) pline_The(\"flow reduces to a trickle.\");\n",
     "			if(!mtmp) { extern void FDECL(web_trickle, (int, int)); web_trickle(x, y); pline_The(\"flow reduces to a trickle.\"); }\n"),
], "WEB_HOOK_WARN")
# BrickHack: odd things at a fountain (fountain.c), each played by the client (web_fountfx): the urge to take a
# bath (dipping: you dive in and jump out, shaking yourself off; gold lost or not); foul water (you lean
# into the fountain, retching); contaminated water (poisoned: a purple haze about you)
B = "{ extern void FDECL(web_fountfx, (const char *)); web_fountfx(\"%s\"); } "
edit("src/fountain.c", [
    ("\t\t\tpline(\"An urge to take a bath overwhelms you.\");\n",
     "\t\t\t" + B % "bath" + "pline(\"An urge to take a bath overwhelms you.\"); /* WEB_HOOK_FOUNTFX */\n"),
    ("\t\t\tpline(\"An urge to take a bath overwhelms you.\");\n",
     "\t\t\t" + B % "bath" + "pline(\"An urge to take a bath overwhelms you.\");\n"),
    ("\t\t\tpline_The(\"water is foul!  You gag and vomit.\");\n",
     "\t\t\t" + B % "foul" + "pline_The(\"water is foul!  You gag and vomit.\");\n"),
    ("\t\t\tpline_The(\"water is contaminated!\");\n",
     "\t\t\t" + B % "poison" + "pline_The(\"water is contaminated!\");\n"),
], "WEB_HOOK_FOUNTFX")
# ...and more of them: "This water's no good!" (a dark puff, your things cursed); bad breath (a faint wisp off
# you, monsters fleeing); a strange tingling, a sudden chill (dipping: a shiver); and coins seen glistening
# far below (dipping: gold strewn in its basin, glinting)
edit("src/fountain.c", [
    ("\t\t\tpline(\"This water's no good!\");\n",
     "\t\t\t" + B % "curse" + "pline(\"This water's no good!\"); /* WEB_HOOK_FOUNTFX2 */\n"),
    ("\t\t\tpline(\"This water gives you bad breath!\");\n",
     "\t\t\t" + B % "breath" + "pline(\"This water gives you bad breath!\");\n"),
] + [("\t\t\tpline(\"A strange tingling runs up your %s.\",\n",
      "\t\t\t" + B % "shiver" + "pline(\"A strange tingling runs up your %s.\",\n")] * 2
  + [("\t\t\tYou_feel(\"a sudden chill.\");\n",
      "\t\t\t" + B % "shiver" + "You_feel(\"a sudden chill.\");\n")] * 2
  + [("\t\t    if (!Blind)\n\t\tpline(\"Far below you, you see coins glistening in the water.\");\n",
      "\t\t    " + B % "coins" + "if (!Blind)\n\t\tpline(\"Far below you, you see coins glistening in the water.\");\n")] * 2,
  "WEB_HOOK_FOUNTFX2")

# BrickHack: a sink and a toilet, and all their doings, played by the client (web_furnfx: which, what, where, and a
# word more (a potion's colour); web_furnobj: a thing with it (a ring found, dropped down the drain; a thing dipped);
# web_rise_from: a monster up out of it (crocodiles out of a toilet kicked to pieces))
edit("src/fountain.c", [
    ('#include "hack.h"\n',
     '#include "hack.h"\n/* WEB_HOOK_FURNFX */\nextern void FDECL(web_furnfx, (const char *, const char *, int, int, const char *));\nextern void FDECL(web_furnobj, (const char *, const char *, int, int, struct obj *));\nextern void FDECL(web_rise_from, (struct monst *, int, int));\n'),
    ('\t\tfloating_above("sink");\n\t\treturn;\n\t}\n\tswitch(rn2(20)) {\n',
     '\t\tfloating_above("sink");\n\t\treturn;\n\t}\n\tweb_furnfx("sink", "sip", u.ux, u.uy, (char *)0);\n\tswitch(rn2(20)) {\n'),
    ('\t\tcase 0: You("take a sip of very cold water.");',
     '\t\tcase 0: web_furnfx("sink", "cold", u.ux, u.uy, (char *)0), You("take a sip of very cold water.");'),
    ('\t\tcase 1: You("take a sip of very warm water.");',
     '\t\tcase 1: web_furnfx("sink", "warm", u.ux, u.uy, (char *)0), You("take a sip of very warm water.");'),
    ('\t\tcase 2: You("take a sip of scalding hot water.");',
     '\t\tcase 2: web_furnfx("sink", "scald", u.ux, u.uy, (char *)0), You("take a sip of scalding hot water.");'),
    ('\t\t\t\tif (mtmp) pline("Eek!  There\'s %s in the sink!",',
     '\t\t\t\tif (mtmp) web_rise_from(mtmp, u.ux, u.uy), pline("Eek!  There\'s %s in the sink!",'),
    ('\t\t\tpline("Some %s liquid flows from the faucet.",',
     '\t\t\tweb_furnfx("sink", "potion", u.ux, u.uy, OBJ_DESCR(objects[otmp->otyp])), pline("Some %s liquid flows from the faucet.",'),
    ('\t\t\t    You("find a ring in the sink!");\n\t\t\t    (void) mkobj_at(RING_CLASS, u.ux, u.uy, TRUE);\n',
     '\t\t\t    You("find a ring in the sink!");\n\t\t\t    web_furnobj("sink", "ring", u.ux, u.uy, mkobj_at(RING_CLASS, u.ux, u.uy, TRUE));\n'),
    ('\t\t\t} else pline("Some dirty water backs up in the drain.");',
     '\t\t\t} else web_furnfx("sink", "dirty", u.ux, u.uy, (char *)0), pline("Some dirty water backs up in the drain.");'),
    ('\t\tcase 7: pline_The("water moves as though of its own will!");',
     '\t\tcase 7: web_furnfx("sink", "elemental", u.ux, u.uy, (char *)0), pline_The("water moves as though of its own will!");'),
    ('\t\tcase 8: pline("Yuk, this water tastes awful.");',
     '\t\tcase 8: web_furnfx("sink", "awful", u.ux, u.uy, (char *)0), pline("Yuk, this water tastes awful.");'),
    ('\t\tcase 9: pline("Gaggg... this tastes like sewage!  You vomit.");',
     '\t\tcase 9: web_furnfx("sink", "sewage", u.ux, u.uy, (char *)0), pline("Gaggg... this tastes like sewage!  You vomit.");'),
    ('\t\t\tpline("This water contains toxic wastes!");',
     '\t\t\tweb_furnfx("sink", "toxic", u.ux, u.uy, (char *)0), pline("This water contains toxic wastes!");'),
    ('\t\tcase 11: You_hear("clanking from the pipes...");',
     '\t\tcase 11: web_furnfx("sink", "clank", u.ux, u.uy, (char *)0), You_hear("clanking from the pipes...");'),
    ('\t\tcase 12: You_hear("snatches of song from among the sewers...");',
     '\t\tcase 12: web_furnfx("sink", "song", u.ux, u.uy, (char *)0), You_hear("snatches of song from among the sewers...");'),
    ('\t\tdefault: You("take a sip of %s water.",',
     '\t\tdefault: web_furnfx("sink", "water", u.ux, u.uy, (char *)0), You("take a sip of %s water.",'),
    ('    if(cansee(x,y) || (x == u.ux && y == u.uy))\n\tpline_The("pipes break!  Water spurts out!");\n',
     '    if(cansee(x,y) || (x == u.ux && y == u.uy))\n\tpline_The("pipes break!  Water spurts out!");\n    web_furnfx("sink", "break", x, y, (char *)0);\n'),
    ('\t\tfloating_above("toilet");\n\t\treturn;\n\t}\n\tif ((youmonst.data->mlet == S_DOG) && (rn2(5))){\n',
     '\t\tfloating_above("toilet");\n\t\treturn;\n\t}\n\tweb_furnfx("toilet", "gulp", u.ux, u.uy, (char *)0);\n\tif ((youmonst.data->mlet == S_DOG) && (rn2(5))){\n'),
    ('\t\tpline("The toilet water is quite refreshing!");',
     '\t\tweb_furnfx("toilet", "refreshing", u.ux, u.uy, (char *)0), pline("The toilet water is quite refreshing!");'),
    ('\t\t\t\tpline("The toilet seems quite dirty.");',
     '\t\t\t\tweb_furnfx("toilet", "dirty", u.ux, u.uy, (char *)0), pline("The toilet seems quite dirty.");'),
    ('\t\t\t\tpline("Eek!  There\'s %s in the toilet!",',
     '\t\t\t\tweb_rise_from(mtmp, u.ux, u.uy), pline("Eek!  There\'s %s in the toilet!",'),
    ('\t\tcase 2: pline("Something begins to crawl out of the toilet!");',
     '\t\tcase 2: web_furnfx("toilet", "ooze", u.ux, u.uy, (char *)0), pline("Something begins to crawl out of the toilet!");'),
    ('\t\t\t\tpline("But it slithers back out of sight.");',
     '\t\t\t\tweb_furnfx("toilet", "slither", u.ux, u.uy, (char *)0), pline("But it slithers back out of sight.");'),
    ('\t\t\t\tpline("The toilet smells fishy.");',
     '\t\t\t\tweb_furnfx("toilet", "fishy", u.ux, u.uy, (char *)0), pline("The toilet smells fishy.");'),
    ('\t\t\t\tpline("Egad!  There\'s %s in the toilet!",',
     '\t\t\t\tweb_rise_from(mtmp, u.ux, u.uy), pline("Egad!  There\'s %s in the toilet!",'),
    ('\t\tdefault: pline("Gaggg... this tastes like sewage!  You vomit.");',
     '\t\tdefault: web_furnfx("toilet", "sewage", u.ux, u.uy, (char *)0), pline("Gaggg... this tastes like sewage!  You vomit.");'),
    ('    pline("The toilet suddenly shatters!");\n',
     '    web_furnfx("toilet", "break", x, y, (char *)0), pline("The toilet suddenly shatters!");\n'),
    ('\t    if((mtmp = makemon(&mons[PM_BABY_CROCODILE],u.ux,u.uy, NO_MM_FLAGS)) &&\n',
     '\t    if((mtmp = makemon(&mons[PM_BABY_CROCODILE],u.ux,u.uy, NO_MM_FLAGS)) && (web_rise_from(mtmp, x, y), 1) &&\n'),
    ("\t(void) get_wet(obj, FALSE);\n\t/* KMH -- acid and water don't mix */\n",
     '\tweb_furnobj("toilet", "dip", u.ux, u.uy, obj);\n\t(void) get_wet(obj, FALSE);\n\t/* KMH -- acid and water don\'t mix */\n'),
], "WEB_HOOK_FURNFX")
edit("src/sit.c", [
    ('#include "hack.h"\n',
     '#include "hack.h"\n/* WEB_HOOK_FURNFX */\nextern void FDECL(web_furnfx, (const char *, const char *, int, int, const char *));\nextern void FDECL(web_furnobj, (const char *, const char *, int, int, struct obj *));\nextern void FDECL(web_rise_from, (struct monst *, int, int));\n'),
    ('\t    You(sit_message, defsyms[S_toilet].explanation);',
     '\t    web_furnfx("toilet", "sit", u.ux, u.uy, (char *)0), You(sit_message, defsyms[S_toilet].explanation);'),
    ('\t\t\telse You("grunt.");',
     '\t\t\telse web_furnfx("toilet", "grunt", u.ux, u.uy, (char *)0), You("grunt.");'),
], "WEB_HOOK_FURNFX")
edit("src/pray.c", [
    ('#include "hack.h"\n',
     '#include "hack.h"\n/* WEB_HOOK_FURNFX */\nextern void FDECL(web_furnfx, (const char *, const char *, int, int, const char *));\nextern void FDECL(web_furnobj, (const char *, const char *, int, int, struct obj *));\nextern void FDECL(web_rise_from, (struct monst *, int, int));\n'),
    ('\tpline("You pray to the Porcelain God.");',
     '\tweb_furnfx("toilet", "pray", u.ux, u.uy, (char *)0), pline("You pray to the Porcelain God.");'),
    ('\tpline("He smiles upon you.");',
     '\tweb_furnfx("toilet", "smiles", u.ux, u.uy, (char *)0), pline("He smiles upon you.");'),
], "WEB_HOOK_FURNFX")
edit("src/dokick.c", [
    ('#include "hack.h"\n',
     '#include "hack.h"\n/* WEB_HOOK_FURNFX */\nextern void FDECL(web_furnfx, (const char *, const char *, int, int, const char *));\nextern void FDECL(web_furnobj, (const char *, const char *, int, int, struct obj *));\nextern void FDECL(web_rise_from, (struct monst *, int, int));\n'),
    ('\t\t   pline("Klunk!");\n\t\t   if (!rn2(4)) breaktoilet(x,y);',
     '\t\t   web_furnfx("toilet", "klunk", x, y, (char *)0), pline("Klunk!");\n\t\t   if (!rn2(4)) breaktoilet(x,y);'),
    ('\t\t\tif(flags.soundok)\n\t\t\t    pline("Klunk!  The pipes vibrate noisily.");',
     '\t\t\tweb_furnfx("sink", "klunk", x, y, (char *)0);\n\t\t\tif(flags.soundok)\n\t\t\t    pline("Klunk!  The pipes vibrate noisily.");'),
    ('\t\t\t    pline("A %s ooze gushes up from the drain!",',
     '\t\t\t    web_furnfx("sink", "pudding", x, y, (char *)0), pline("A %s ooze gushes up from the drain!",'),
    ('\t\t\tpline("%s returns!", (Blind ? Something :',
     '\t\t\tweb_furnfx("sink", "washer", x, y, (char *)0), pline("%s returns!", (Blind ? Something :'),
    ('\t\t\tpline("Flupp!  %s.", (Blind ?',
     '\t\t\tweb_furnfx("sink", "flupp", x, y, (char *)0), pline("Flupp!  %s.", (Blind ?'),
    ('\t\t\t\tYou("see a ring shining in its midst.");',
     '\t\t\t\tweb_furnfx("sink", "shine", x, y, (char *)0), You("see a ring shining in its midst.");'),
], "WEB_HOOK_FURNFX")
edit("src/do.c", [
    ('#include "hack.h"\n',
     '#include "hack.h"\n/* WEB_HOOK_FURNFX */\nextern void FDECL(web_furnfx, (const char *, const char *, int, int, const char *));\nextern void FDECL(web_furnobj, (const char *, const char *, int, int, struct obj *));\nextern void FDECL(web_rise_from, (struct monst *, int, int));\n'),
    ('\tYou("drop %s down the drain.", doname(obj));',
     '\tweb_furnobj("sink", "ringdown", u.ux, u.uy, obj), You("drop %s down the drain.", doname(obj));'),
    ('\t\tpline_The("ring is regurgitated!");',
     '\t\tweb_furnfx("sink", "ringback", u.ux, u.uy, (char *)0), pline_The("ring is regurgitated!");'),
    ('\t\tYou("thought your %s got lost in the sink, but there it is!",',
     '\t\tweb_furnfx("sink", "ringback", u.ux, u.uy, (char *)0), You("thought your %s got lost in the sink, but there it is!",'),
], "WEB_HOOK_FURNFX")

# BrickHack: praying, played by the client as it goes (web_pray): begun (how it'll go: p_type), and what comes of
# it: your god pleased (how much), or displeased, angered (a voice, a black glow, punished, a minion, lightning, a
# disintegration beam), too soon, undead, in Gehennom
edit("src/pray.c", [
    ('#include "hack.h"\n',
     '#include "hack.h"\n/* WEB_HOOK_PRAY */\nextern void FDECL(web_pray, (const char *, int));\n'),
    ('    nomul(-3);\n    nomovemsg = "You finish your prayer.";\n',
     '    web_pray("begin", p_type);\n    nomul(-3);\n    nomovemsg = "You finish your prayer.";\n'),
    ('\tYou_feel("like you are falling apart.");',
     '\tweb_pray("undead", -1), You_feel("like you are falling apart.");'),
    ('\tpline("Since you are in Gehennom, %s won\'t help you.",',
     '\tweb_pray("hell", 0), pline("Since you are in Gehennom, %s won\'t help you.",'),
    ('\tu.ublesscnt += rnz(250);\n\tchange_luck(-3);\n\tgods_upset(u.ualign.type);\n    } else if(p_type == 1) {',
     '\tweb_pray("toosoon", 0);\n\tu.ublesscnt += rnz(250);\n\tchange_luck(-3);\n\tgods_upset(u.ualign.type);\n    } else if(p_type == 1) {'),
    ('\tYou_feel("that %s is %s.", align_gname(g_align),',
     '\tweb_pray("pleased", u.ualign.record >= DEVOUT ? 3 : u.ualign.record >= STRIDENT ? 2 : 1), You_feel("that %s is %s.", align_gname(g_align),'),
    ('\t    case 1:\tYou_feel("that %s is %s.", align_gname(resp_god),',
     '\t    case 1:\tweb_pray("displeased", 0), You_feel("that %s is %s.", align_gname(resp_god),'),
    ('\t    case 2:\n\t    case 3:\n\t\t\tgodvoice(resp_god,(char *)0);\n',
     '\t    case 2:\n\t    case 3:\n\t\t\tweb_pray("lessons", 0);\n\t\t\tgodvoice(resp_god,(char *)0);\n'),
    ('\t\t\t    pline("%s glow surrounds you.",',
     '\t\t\t    web_pray("blackglow", 0), pline("%s glow surrounds you.",'),
    ('\t\t\t    punish((struct obj *)0);',
     '\t\t\t    web_pray("punish", 0), punish((struct obj *)0);'),
    ('\t\t\tverbalize("Thou durst %s me?",',
     '\t\t\tweb_pray("minion", 0), verbalize("Thou durst %s me?",'),
    ('\t    pline("Suddenly a bolt of lightning comes down at you from the heavens!");',
     '\t    web_pray("bolt", 0), pline("Suddenly a bolt of lightning comes down at you from the heavens!");'),
    ('\t    pline("Suddenly, a bolt of lightning strikes you!");',
     '\t    web_pray("bolt", 0), pline("Suddenly, a bolt of lightning strikes you!");'),
    ('\t    pline("A wide-angle disintegration beam aimed at you hits %s!",',
     '\t    web_pray("disintegrate", 0), pline("A wide-angle disintegration beam aimed at you hits %s!",'),
    ('\t    pline("A wide-angle disintegration beam hits you!");',
     '\t    web_pray("disintegrate", 0), pline("A wide-angle disintegration beam hits you!");'),
], "WEB_HOOK_PRAY")

# BrickHack: a box or a chest kicked (dokick.c), played by the client (web_boxfx): the thud, what breaks inside
# it (a muffled shatter, a crack: the thing, for its colour), its lock broken, its lid slammed open and shut
edit("src/dokick.c", [
    ('#include "hack.h"\n',
     '#include "hack.h"\n/* WEB_HOOK_BOXFX */\nextern void FDECL(web_boxfx, (const char *, int, int, struct obj *));\n'),
    ('\t\tif(range < 2) pline("THUD!");',
     '\t\tif(range < 2) web_boxfx("thud", kickobj->ox, kickobj->oy, (struct obj *)0), pline("THUD!");'),
    ('\t\tYou_hear("a muffled %s.", result);',
     '\t\tweb_boxfx(*result == \'s\' ? "shatter" : "crack", x, y, otmp), You_hear("a muffled %s.", result);'),
    ('\t\t\tYou("break open the lock!");\n\t\t\tkickobj->olocked = 0;',
     '\t\t\tweb_boxfx("lockbreak", kickobj->ox, kickobj->oy, (struct obj *)0), You("break open the lock!");\n\t\t\tkickobj->olocked = 0;'),
    ('\t\t\tpline_The("lid slams open, then falls shut.");',
     '\t\t\tweb_boxfx("slam", kickobj->ox, kickobj->oy, (struct obj *)0), pline_The("lid slams open, then falls shut.");'),
], "WEB_HOOK_BOXFX")
# BrickHack: what happens at an altar (pray.c dosacrifice, consume_offering, altar_wrath; do.c doaltarobj),
# played by the client there (winweb.c web_altarfx): a sacrifice held up and laid on it, gone up in a bolt of
# fire from the sky; what comes of it (a four-leaf clover, a gift, an altar converted, refused, bloodied...);
# things landing on it in an amber or a black flash; kicked, its god's wrath
AFX = "web_altarfx"
NOOBJ = "(struct obj *)0"
edit("src/pray.c", [
    ('#include "hack.h"\n',
     '#include "hack.h"\n/* WEB_HOOK_ALTARFX */\nextern void FDECL(web_altarfx, (const char *, int, struct obj *));\n'),
    ('if (web_offer(otmp)) return 1; } /* WEB_HOOK_RITES */\n',
     'if (web_offer(otmp)) return 1; } /* WEB_HOOK_RITES */\n    web_altarfx("offer", 0, otmp);\n'),
    ('    else Your("sacrifice is consumed in a %s!",',
     '    else web_altarfx("consume", u.ualign.type == A_LAWFUL, otmp), Your("sacrifice is consumed in a %s!",'),
    ('\t\telse You(Hallucination ?\n\t\t    "see crabgrass',
     '\t\telse web_altarfx("clover", 0, (struct obj *)0), You(Hallucination ?\n\t\t    "see crabgrass'),
    ('\t\t\tpline_The("altar glows %s.",',
     '\t\t\tweb_altarfx("convert", u.ualign.type, (struct obj *)0), pline_The("altar glows %s.",'),
    ('\t\t    pline("Unluckily, you feel the power of %s decrease.",',
     '\t\t    web_altarfx("decrease", 0, (struct obj *)0), pline("Unluckily, you feel the power of %s decrease.",'),
    ('\t\t    pline("%s rejects your sacrifice!", a_gname());',
     '\t\t    web_altarfx("reject", 0, (struct obj *)0), pline("%s rejects your sacrifice!", a_gname());'),
    ('\t\t    pline_The("altar is stained with %s blood.",',
     '\t\t    web_altarfx("blood", 0, (struct obj *)0), pline_The("altar is stained with %s blood.",'),
    ('\t\t    pline_The("blood covers the altar, and a dark cloud forms!");',
     '\t\t    web_altarfx("blood", 1, (struct obj *)0), pline_The("blood covers the altar, and a dark cloud forms!");'),
    ('\t\t    at_your_feet("An object");',
     '\t\t    web_altarfx("gift", 0, otmp), at_your_feet("An object");'),
    ('\t\t    pline("A spellbook appears at your %s!",',
     '\t\t    web_altarfx("gift", 0, (struct obj *)0), pline("A spellbook appears at your %s!",'),
    ('\t    You_feel("partially absolved.");',
     '\t    web_altarfx("hopeful", 0, (struct obj *)0), You_feel("partially absolved.");'),
    ('\t\t\tYou("have a hopeful feeling.");',
     '\t\t\tweb_altarfx("hopeful", 0, (struct obj *)0), You("have a hopeful feeling.");'),
    ('\t\t\tYou("have a feeling of reconciliation.");',
     '\t\t\tweb_altarfx("hopeful", 1, (struct obj *)0), You("have a feeling of reconciliation.");'),
    ('\t\telse You("have a feeling of inadequacy.");',
     '\t\telse web_altarfx("inadequacy", 0, (struct obj *)0), You("have a feeling of inadequacy.");'),
    ('\tgodvoice(altaralign, "How darest thou desecrate my altar!");',
     '\tweb_altarfx("wrath", 1, (struct obj *)0), godvoice(altaralign, "How darest thou desecrate my altar!");'),
    ('\tpline("A voice (could it be %s?) whispers:",',
     '\tweb_altarfx("wrath", 0, (struct obj *)0), pline("A voice (could it be %s?) whispers:",'),
], "WEB_HOOK_ALTARFX")
edit("src/do.c", [
    ('#include "hack.h"\n',
     '#include "hack.h"\n/* WEB_HOOK_ALTARFX */\nextern void FDECL(web_altarfx, (const char *, int, struct obj *));\n'),
    ('\t\tThere("is %s flash as %s %s the altar.",',
     '\t\tweb_altarfx(obj->blessed ? "blessed" : "cursed", 0, obj), There("is %s flash as %s %s the altar.",'),
], "WEB_HOOK_ALTARFX")

print("engine hooks applied:", src)
