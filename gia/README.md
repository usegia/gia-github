# Gia project

This directory is the committed half of a Gia workspace.

| Path | Owner | Edit? |
| --- | --- | --- |
| `project.json` | you | yes — connection, scope, exact value-evidence restrictions |
| `world.json` | you | yes — the World overlay: names, prose, derives, joins, suppressions |
| `guidance/*.json` | you | yes — planner guidance sources |
| `review/proposals/` | `gia` CLI | review first; approve typed ids into `world.json` |
| `generated/` | `gia` CLI | never by hand — complete generator output, reproducible from evidence |

Machine-local state (credentials, caches, transactions) lives in `../.gia/`,
which is gitignored. Deleting `.gia/` never loses project state.

Common commands:

```
gia refresh --environment dev   # re-harvest evidence, recompose, publish
gia proposals                   # list mined suggestions
gia approve <id>                # land a suggestion into world.json
gia publish                     # re-derive projections and push a snapshot
```
