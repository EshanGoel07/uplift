# Credits and licences

Uplift itself is released under the Apache License 2.0.

It uses the following third-party data and code:

| Source | Used for | Licence |
| --- | --- | --- |
| [SWE-rebench](https://huggingface.co/datasets/nebius/SWE-rebench) (Nebius) | Pre-validated bug-fix tasks: problem statements, fix and test patches, `FAIL_TO_PASS` / `PASS_TO_PASS` test lists | [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/) (checked on the dataset card, 2026-10-31). Cite: *SWE-rebench: An Automated Pipeline for Task Collection and Decontaminated Evaluation of Software Engineering Agents*, [arXiv:2505.20411](https://arxiv.org/abs/2505.20411) |
| [sqlglot](https://github.com/tobymao/sqlglot) by Toby Mao | The repository whose past bugs we replay, and the source of the fresh tasks Uplift mines from its commits and GitHub issues | MIT, Copyright (c) Toby Mao |

Changes to SWE-rebench data: Uplift uses only the sqlglot tasks, re-validates them, splits them by
date, and screens their `FAIL_TO_PASS` lists (a test is left out when Muse Spark judges that the
issue does not describe it). The dataset itself is not redistributed in this repository, and
neither is sqlglot: both are downloaded at run time into a git-ignored folder.

Each SWE-rebench task also carries the licence of the repository it comes from;
Uplift keeps that field (`license_name`) on every task record. All sqlglot tasks are MIT.

All models Uplift calls at runtime are Meta models (Muse family), as the Meta
Global AI Developer Hackathon rules require.
