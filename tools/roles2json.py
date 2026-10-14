#!/usr/bin/env python3
"""Export SLASH'EM's role and race rules for the character creation screen.

  roles2json.py vendor/SlashEM web/assets/slashem/roles.json

Reads the (patched) src/role.c and writes, for every role and race, the race
groups (MH_*), genders and alignments it allows:

  {"roles": {"Knight": {"races": ["HUMAN"], "genders": ["male", "female"],
                        "aligns": ["lawful"]}, ...},
   "races": {"elf": {"races": ["ELF", "HUMAN"], ...}, ...}}

The game's own rule (role.c validrace/validgend/validalign): a role and race
go together if they share a race group, a gender and an alignment; a gender
or alignment is allowed if both the role and the race allow it.
"""
import json, re, sys

GENDERS = {'ROLE_MALE': 'male', 'ROLE_FEMALE': 'female'}
ALIGNS = {'ROLE_LAWFUL': 'lawful', 'ROLE_NEUTRAL': 'neutral', 'ROLE_CHAOTIC': 'chaotic'}


def mask(text):
    """The parts of an allow mask like 'MH_HUMAN|MH_ELF | ROLE_MALE | ROLE_LAWFUL'."""
    words = re.findall(r'\b(MH_[A-Z]+|ROLE_[A-Z]+)\b', text)
    return {
        'races': sorted({w[3:] for w in words if w.startswith('MH_')}),
        'genders': [g for k, g in GENDERS.items() if k in words],
        'aligns': [a for k, a in ALIGNS.items() if k in words],
    }


def main(src, out):
    s = open(src + '/src/role.c', encoding='latin-1').read()
    roles_src = s[s.index('const struct Role roles[]'):s.index('const struct Race races[]')]
    races_src = s[s.index('const struct Race races[]'):]
    roles = {}
    # each role entry starts {	{"Name", ...}; its allow mask is the first run of MH_ and ROLE_ flags
    for m in re.finditer(r'\{\s*\{"([^"]+)",[^\n]*\n(.*?)(?=\n\{\s*\{"|\Z)', roles_src, re.S):
        allow = re.search(r'(MH_[A-Z_|\s]*\|\s*ROLE_[A-Z_|\s]*)', m.group(2))   # (may wrap onto a second line)
        if allow:
            roles[m.group(1)] = mask(allow.group(1))
    races = {}
    # each race entry starts {	"name", "adj", ...; its allow mask likewise
    for m in re.finditer(r'\{\s*"([a-z]+)", "[a-z]+", "[a-z-]+", "[A-Za-z]+"(.*?)(?=\n\{\s*"|\Z)', races_src, re.S):
        allow = re.search(r'(MH_[A-Z_|\s]*\|\s*ROLE_[A-Z_|\s]*)', m.group(2))   # (may wrap onto a second line)
        if allow:
            races[m.group(1)] = mask(allow.group(1))
    json.dump({'roles': roles, 'races': races}, open(out, 'w'), indent=1)
    print(f'{len(roles)} roles, {len(races)} races -> {out}')


if __name__ == '__main__':
    main(*sys.argv[1:3])
