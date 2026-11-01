"""Failure rules and the Muse Spark labeller, with a fake model."""

import json

import pytest

from uplift import label


DIFF = "diff --git a/sqlglot/parser.py b/sqlglot/parser.py\n--- a/sqlglot/parser.py\n+++ b/sqlglot/parser.py\n+x\n"


def test_rules_are_read_from_facts():
    res = {"grade": {"p2p_failed": ["tests/a.py::b"]}, "agent_end": "run ended with Failed: model did not reach a terminal state within 40 step(s)"}
    r = label.rules(res, DIFF, ["sqlglot/generator.py"], ran_tests=False)
    assert r == {"edited_no_fix_file": True, "broke_p2p": True, "never_ran_tests": True, "step_limit": True}
    r = label.rules({"grade": {"p2p_failed": []}, "agent_end": ""}, DIFF, ["sqlglot/parser.py"], ran_tests=True)
    assert not any(r.values())


def test_an_empty_diff_edited_no_fix_file():
    assert label.rules({"grade": {}}, "", ["a.py"], True)["edited_no_fix_file"]


def test_prompt_holds_only_issue_files_and_diff():
    msgs, cut = label.build_messages("The bug", ["sqlglot/parser.py"], DIFF)
    text = msgs[1]["content"]
    assert "The bug" in text and "sqlglot/parser.py" in text and not cut
    for word in ("sensors", "tuned", "handwritten", "seed", "resolved", "p2p"):
        assert word not in text.lower()


def test_prompt_cuts_a_huge_diff_and_says_so():
    msgs, cut = label.build_messages("i", ["a"], "x" * (label.MAX_DIFF_CHARS + 5))
    assert cut and "[... cut ...]" in msgs[1]["content"]


def test_parse_label_refuses_anything_off_the_list():
    assert label.parse_label('{"label": "Wrong File", "reason": "r"}') == ("wrong file", "r")
    assert label.parse_label('{"label": "bad luck", "reason": "r"}') is None
    assert label.parse_label("no json") is None
    assert label.parse_label(None) is None


def reply(text):
    return {"choices": [{"message": {"content": text}}]}


ITEM = {"task": "t1", "arm": "x", "seed": 1, "cut": False, "messages": [{"role": "user", "content": "q"}],
        "rules": {"edited_no_fix_file": True, "broke_p2p": False, "never_ran_tests": False, "step_limit": False}}


def test_judge_saves_and_reuses_so_a_rerun_pays_nothing(tmp_path):
    calls = []

    def fake(messages, max_tokens):
        calls.append(max_tokens)
        return reply('{"label": "wrong file", "reason": "r"}')

    one = label.judge(ITEM, tmp_path, fake)
    two = label.judge(ITEM, tmp_path, fake)
    assert one["label"] == two["label"] == "wrong file" and len(calls) == 1


def test_judge_retries_with_more_tokens_then_raises_without_saving(tmp_path):
    calls = []

    def fake(messages, max_tokens):
        calls.append(max_tokens)
        return reply("")

    with pytest.raises(RuntimeError):
        label.judge(ITEM, tmp_path, fake)
    assert calls == [label.MAX_TOKENS, 2 * label.MAX_TOKENS, 4 * label.MAX_TOKENS]
    assert not label.item_path(tmp_path, ITEM).exists()


def test_agreement_counts_each_cell():
    r = lambda rule, lab: {"rules": dict(ITEM["rules"], edited_no_fix_file=rule), "label": lab}   # noqa: E731
    rows = label.agreement([r(True, "wrong file"), r(True, "other"), r(False, "wrong file"), r(False, "other")])
    wf = next(x for x in rows if x["label"] == "wrong file")
    assert (wf["both"], wf["rule_only"], wf["spark_only"], wf["neither"]) == (1, 1, 1, 1)
