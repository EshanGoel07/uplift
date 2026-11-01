"""Report pieces that don't need a full batch."""

from uplift import report


def test_limitations_come_from_the_submission_file():
    text = "# x\n\n## Limitations to state honestly (decided)\n\n- One repo.\n- One agent.\n\n## Before submitting\n\n- Other.\n"
    assert report.limitations(text) == ["- One repo.", "- One agent."]


def test_table_shape():
    assert report.table(["a", "b"], [[1, 2]]) == ["| a | b |", "| --- | --- |", "| 1 | 2 |"]
