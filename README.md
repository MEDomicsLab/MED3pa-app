# MED3pa — standalone application

A desktop application for **MED3pa** (Predictive Performance Precision Analysis): uncertainty
estimation, problematic-profile discovery, and declaration-rate driven deployment of a
classification model.

This repository is an extraction of the MED3pa module from
[MEDomicsLab](https://github.com/MEDomicsLab/MEDomics). Everything unrelated to MED3pa —
the Learning / MEDml flow editor, MEDimage, MEDprofiles, Evaluation, Exploratory, Extraction,
MEDfl, Superset, the notebook editor and the terminal — has been removed. What remains is the
MED3pa module plus the minimum platform it needs to run.

---

## Architecture

Four layers, same as MEDomicsLab but with one module in each:

```
Electron main (main/)          window, MongoDB lifecycle, Go server lifecycle, python env
        │  ipc
Renderer (renderer/)           Next.js UI — the MED3pa pages + a thin app shell
        │  HTTP :54288
Go server (go_server/)         request dispatcher; spawns python scripts, streams progress
        │  stdin/stdout JSON
Python (pythonCode/)           MED3pa analysis, model application, external-model import
        │
MongoDB :54017                 datasets, models (GridFS), sessions, deployments, patients
```

Nothing talks to MED3pa directly from the UI: the renderer posts a JSON config to the Go
server, which runs the matching python script and pipes progress back.

### Layout

| Path | What it is |
|---|---|
| `renderer/components/med3pa/` | The MED3pa UI — Overview, Configuration, Analysis Workspace, Deployment, Patient Lookup, Session History |
| `renderer/components/shell/` | App chrome: workspace gate, header, Data & Models panel |
| `renderer/components/workspace/` | MEDDataObject model, data/workspace contexts, the dataset & model picker |
| `renderer/components/mongoDB/` | MongoDB access from the renderer |
| `pythonCode/modules/med3pa/` | `run_med3pa_analysis.py`, `apply_med3pa_model.py`, confidence metrics, MPC strategies, safe expression evaluator |
| `pythonCode/modules/models/` | `import_external_model.py` — wraps ONNX / pickle / joblib models as `.medmodel` |
| `pythonCode/med_libs/` | Go↔python protocol, MongoDB helpers, model loading |
| `go_server/blueprints/` | `med3pa` (analysis, apply, progress) and `models` (import) routes |

---

## Getting started

### 1. Prerequisites

- **Node.js** 18+
- **Go** 1.21+
- **Python** 3.9–3.12
- **MongoDB** — the app starts and stops `mongod` itself against a config it writes into
  your workspace at `.medomics/mongod.conf` (port `54017`). It must be on your `PATH`, or
  installed through the app's installer helper.

### 2. Installing MED3pa

MED3pa is **not on PyPI**. `pythonEnv/requirements.txt` pins it to a GitHub commit:

```bash
pip install -r pythonEnv/requirements.txt
```

If you are developing against a local checkout of the MED3pa library, replace that line in
`pythonEnv/requirements.txt` with an editable install pointing at your clone, for example:

```bash
pip install -e ../packages/MED3pa
```

Note that the library's built-in-metric-by-name path is known to raise a `TypeError`; pass
metric callables rather than strings if you hit it.

### 3. Install and run

```bash
npm install
```

```bash
npm run dev
```

`nextron` builds the renderer and launches Electron. On first launch you are asked to pick a
**workspace folder** — this is where `DATA/` lives and where MongoDB stores its files.

### 4. Building the Go server

The dev script on Linux builds it for you. Elsewhere:

```bash
cd go_server && go build main.go
```

For a packaged build, `utilScripts/pack_GO.bat` (Windows) or `utilScripts/pack_GO.sh` copies
the binary into `go_executables/`, which `electron-builder` ships as an extra resource.

---

## Using the app

1. **Data & Models** (header button) — import CSV datasets into the workspace, and import a
   base model (`.onnx`, `.pkl`, `.pickle`, `.joblib`) declaring its feature columns and target.
2. **Configuration** — pick the base model (or a column of predicted probabilities), the
   dataset, the target column, and the IPC/APC/MPC settings; run the analysis.
3. **Analysis Workspace** — MDR curves, the APC tree, problematic profiles, per-metric bars.
4. **Deployment** — freeze a session at a declaration rate into a deployed model, then apply
   it to new patients in batch or one at a time.
5. **Patient Lookup / Session History** — browse what has been scanned and what has been run.

---

## What was changed during extraction

Beyond deleting the other modules, three things were rewritten rather than copied:

- **`components/workspace/workspaceFilePicker.jsx`** replaces MEDomicsLab's
  `components/learning/input.jsx`. MED3pa used two of that 835-line component's ~30 cases
  (`data-input`, `models-input`), both thin filters over the workspace data context — so the
  entire Learning module was a dependency for a select box.
- **`components/shell/appShell.jsx`** replaces the flexlayout tab manager, `layoutContext`,
  `layoutManager` and `iconSidebar` (~2,800 lines). With one module there is nothing to
  arrange; MED3pa already carries its own internal navigation.
- **`utilities/pathUtils.js`** replaces `utilities/fileManagementUtils.js`, of which only the
  path-separator helper was reachable.

The Go route `learning/import_external_model/` was renamed to `models/import_external_model/`,
and the terminal subsystem was removed from the Electron main process (dropping the `node-pty`
native dependency).

---

## License

Inherits the license of the MEDomicsLab project.
