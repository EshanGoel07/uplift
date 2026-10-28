# Credits and licences

Uplift itself is released under the Apache License 2.0.

It uses the following third-party data and code:

| Source | Used for | Licence |
| --- | --- | --- |
| [SWE-rebench](https://huggingface.co/datasets/nebius/SWE-rebench) (Nebius) | Pre-validated bug-fix tasks: problem statements, fix and test patches, `FAIL_TO_PASS` / `PASS_TO_PASS` test lists, Docker images | CC-BY-4.0. Cite: *SWE-rebench: An Automated Pipeline for Task Collection and Decontaminated Evaluation of Software Engineering Agents*, arXiv:2505.20411 |
| [sqlglot](https://github.com/tobymao/sqlglot) | The repository whose past bugs we replay | MIT |

Each SWE-rebench task also carries the licence of the repository it comes from;
Uplift keeps that field (`license_name`) on every task record.

All models Uplift calls at runtime are Meta models (Muse family), as the Meta
Global AI Developer Hackathon rules require.
