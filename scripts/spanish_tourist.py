"""Compile original Spanish phrases with explicit source-checked realizations."""

from __future__ import annotations

import re
import unicodedata

from curriculum_yaml import load_yaml
from spanish_sources import canonical_vocabulary, effective_selections, load_projection, record_index, surface_forms


def written(value: str) -> str:
    return "".join(char for char in unicodedata.normalize("NFC", value).casefold()
                   if not char.isspace() and char not in ".,;:!?¿¡…")


def resolve_items(root, vocabulary, aliases):
    selections = effective_selections(root)
    by_lemma = {}
    for row in selections:
        if row["id"] in vocabulary:
            by_lemma.setdefault(row["lemma"], []).append(row["id"])

    def resolve(key):
        if key in vocabulary:
            return key
        if key.startswith("lemma:"):
            lemma = key.removeprefix("lemma:")
            if lemma not in by_lemma:
                raise ValueError(f"Travel vocabulary is unavailable: {lemma}")
            if len(by_lemma[lemma]) != 1:
                raise ValueError(f"Ambiguous lemma {lemma!r}: use an explicit sense alias or ID")
            return by_lemma[lemma][0]
        if key not in aliases or aliases[key] not in vocabulary:
            raise ValueError(f"Unknown travel sense alias: {key}")
        return aliases[key]

    return resolve


def compile_route(root, vocabulary: dict, grammar: dict, authored_grammar: list[dict]):
    _, aliases = canonical_vocabulary(root)
    resolve = resolve_items(root, vocabulary, aliases)
    definitions = load_yaml(root / "authoring" / "tourist-forms.yaml")
    grammar_keys = load_yaml(root / "authoring" / "tourist-grammar-keys.yaml")
    plan = load_yaml(root / "authoring" / "tourist.yaml")
    source = record_index(load_projection(root))
    selections = {row["id"]: row for row in effective_selections(root)}
    patterns = {row["id"]: row for row in authored_grammar}
    forms, licenses = {}, {}
    for form in definitions["forms"]:
        key = form["key"]
        if not isinstance(key, str) or not key:
            raise ValueError("Realization keys must be nonempty strings; quote YAML words such as no")
        if key in forms:
            raise ValueError(f"Duplicate original realization: {key}")
        items = [resolve(form["item"])] if "item" in form else []
        grammar_ids = list(dict.fromkeys(grammar_keys[key] for key in form.get("grammar", [])))
        if not items and not grammar_ids:
            raise ValueError(f"{key}: realization requires a lexical or construction identity")
        if set(grammar_ids) - set(grammar):
            raise ValueError(f"{key}: unknown construction")
        if items:
            selected = selections[items[0]]
            row, _ = source[selected["source_sense_id"]]
            allowed = {written(row["word"]), *(written(value["form"]) for value in surface_forms(row))}
            if form.get("clitic"):
                if form["clitic"] not in {"lo", "la", "los", "las", "me", "te", "se", "nos"}:
                    raise ValueError(f"{key}: invalid attached clitic")
                if (row["pos"] != "verb" or not form["base"].endswith(("ar", "er", "ir"))
                        or written(form["base"]) != written(row["word"])
                        or written(form["ch"]) != written(form["base"] + form["clitic"])
                        or not grammar_ids):
                    raise ValueError(f"{key}: unsupported infinitive/clitic realization")
            elif written(form["ch"]) not in allowed:
                raise ValueError(f"{key}: surface is not a recorded form of {row['word']}")
        else:
            fixed = {written(value) for identifier in grammar_ids
                     for value in patterns[identifier]["fixed_forms"]}
            if written(form["ch"]) not in fixed:
                raise ValueError(f"{key}: fixed form is not introduced by its construction")
        identifier = "es-realization-" + key
        entry = {"ch": form["ch"], "pr": form["pr"], "items": items,
                 "grammar": grammar_ids, "form_id": identifier}
        forms[key] = entry
        licenses[identifier] = entry
    units, known_words, known_patterns = [], [], []
    dependencies = {row["id"]: row["prerequisites"] for row in authored_grammar}
    grammar_anchors = {row["id"]: [resolve(alias) for alias in row["anchors"]] for row in authored_grammar}

    def dependency_closure(identifiers):
        result, active = [], set()

        def visit(identifier):
            if identifier in active:
                raise ValueError(f"Cyclic construction prerequisite: {identifier}")
            if identifier in result:
                return
            active.add(identifier)
            for prerequisite in dependencies[identifier]:
                visit(prerequisite)
            active.remove(identifier)
            result.append(identifier)

        for identifier in identifiers:
            visit(identifier)
        return result

    for definition in plan["units"]:
        phrases, required_words, required_patterns = [], [], []
        for phrase in definition["phrases"]:
            segments, cursor = [], 0
            for key in phrase["forms"]:
                if key not in forms:
                    raise ValueError(f"{phrase['id']}: unknown realization {key}")
                form = forms[key]
                while cursor < len(phrase["ch"]) and (
                    phrase["ch"][cursor].isspace() or unicodedata.category(phrase["ch"][cursor])[0] == "P"
                ):
                    cursor += 1
                expression = re.escape(form["ch"]).replace(r"\ ", r"\s+")
                match = re.match(expression, phrase["ch"][cursor:], flags=re.IGNORECASE)
                if not match:
                    raise ValueError(f"{phrase['id']}: text is not covered at {phrase['ch'][cursor:]!r}")
                segments.append({**form, "ch": match.group()})
                cursor += len(match.group())
            if written(phrase["ch"][cursor:]):
                raise ValueError(f"{phrase['id']}: uncovered text {phrase['ch'][cursor:]!r}")
            items = list(dict.fromkeys(item for segment in segments for item in segment["items"]))
            constructions = list(dict.fromkeys(item for segment in segments for item in segment["grammar"]))
            phrases.append({
                "id": phrase["id"], "ch": phrase["ch"],
                "pr": " ".join(segment["pr"] for segment in segments), "ds": phrase["ds"],
                "items": items, "grammar": constructions, "realizations": segments,
            })
            required_words.extend(items)
            required_patterns.extend(constructions)
        required_patterns = dependency_closure(list(dict.fromkeys(required_patterns)))
        for identifier in required_patterns:
            required_words.extend(grammar_anchors[identifier])
        required_words = list(dict.fromkeys(required_words))
        units.append({
            "id": definition["id"], "title": definition["title"], "outcome": definition["outcome"],
            "vocabulary": [item for item in required_words if item not in known_words],
            "grammar": [item for item in required_patterns if item not in known_patterns],
            "review_vocabulary": [item for item in required_words if item in known_words],
            "review_grammar": [item for item in required_patterns if item in known_patterns],
            "phrases": phrases,
        })
        known_words.extend(item for item in required_words if item not in known_words)
        known_patterns.extend(item for item in required_patterns if item not in known_patterns)
    route = {
        "schema_version": 1, "id": "es-tourist", "title": "Spanish for a short visit",
        "language": "spanish",
        "level_basis": "Independent travel route; no core-course or examination prerequisite.",
        "review_policy": "Use short sessions with 5-8 new senses. Revisit fragile items in changed contexts and on later days. Wordwise IPA is an original broad seseo/yeismo teaching convention, not audio or a universal accent. Confirm local arrangements; no safety, dietary, legal, medical or payment guarantee.",
        "quick_start": plan["quick_start"], "units": units,
    }
    return route, licenses
