#!/usr/bin/env bash
#
# Build the conda environment for the MED3pa standalone app.
#
# Usage:
#   bash pythonEnv/create_conda_env.sh [env_name] [path_to_local_MED3pa_checkout]
#
# With no second argument MED3pa is installed from GitHub at the pinned commit.
# Pass a local checkout to get an editable install instead, which is what you
# want when developing the MED3pa library alongside the app.
#
# Ordering matters here:
#   1. numpy is installed and pinned BEFORE anything else, because installing
#      MED3pa unpinned drags in numpy 2.x and scipy 1.18, which then conflicts
#      with MED3pa's own numpy<2.1.0 requirement.
#   2. scipy is pinned back to 1.11.4 afterwards for the same reason.
#
# Python 3.12 is required: MED3pa pins checkpointer==2.1.0, which declares
# Requires-Python >=3.12.

set -e

ENV_NAME="${1:-med3pa_app}"
MED3PA_LOCAL="${2:-}"
MED3PA_GIT="git+https://github.com/MEDomicsLab/MED3pa.git@639b9c8fa8e249af3cf2613bf806e34bfcc10534"

CONDA="$(command -v conda || echo conda)"

echo "==> Creating conda environment '$ENV_NAME' (python 3.12)"
"$CONDA" create -n "$ENV_NAME" python=3.12 -y

ENV_PREFIX="$("$CONDA" run -n "$ENV_NAME" python -c 'import sys, os; print(os.path.dirname(sys.executable))')"
if [ -f "$ENV_PREFIX/python.exe" ]; then
  PY="$ENV_PREFIX/python.exe"
else
  PY="$ENV_PREFIX/python"
fi
echo "==> Using interpreter: $PY"

echo "==> Pinning numpy first"
"$PY" -m pip install --no-cache-dir "numpy==1.26.4"

if [ -n "$MED3PA_LOCAL" ]; then
  echo "==> Installing MED3pa (editable) from $MED3PA_LOCAL"
  "$PY" -m pip install --no-cache-dir -e "$MED3PA_LOCAL"
else
  echo "==> Installing MED3pa from GitHub at the pinned commit"
  "$PY" -m pip install --no-cache-dir "MED3pa @ $MED3PA_GIT"
fi

echo "==> Installing the app's own dependencies"
"$PY" -m pip install --no-cache-dir "pymongo==4.7.3" "onnxruntime==1.28.0" "joblib==1.5.3"

echo "==> Restoring the numpy / scipy pins that MED3pa's install overrode"
"$PY" -m pip install --no-cache-dir --force-reinstall "numpy==1.26.4"
"$PY" -m pip install --no-cache-dir "scipy==1.11.4"

echo "==> Verifying"
"$PY" -m pip check
"$PY" - <<'PYEOF'
import numpy, pandas, scipy, sklearn, torch, xgboost, onnxruntime, pymongo, joblib
from MED3pa.datasets import DatasetsManager
from MED3pa.med3pa import Med3paExperiment
from MED3pa.med3pa.models import APCModel, IPCModel, MPCModel, MpcStrategy
from MED3pa.med3pa.uncertainty import UncertaintyCalculator, UncertaintyMetric
print("numpy", numpy.__version__, "| pandas", pandas.__version__, "| torch", torch.__version__)
print("MED3pa imports OK")
PYEOF

echo ""
echo "Done. Point the app at this interpreter:"
echo "  $PY"
echo "Set it in the app's System page (Python environment path)."
