#!/usr/bin/env bash
#
# Build a conda environment for developing the MED3pa standalone app.
#
# NOTE: this script is a DEVELOPER convenience. The packaged app does not run it.
# In production the app installs into its own bundled python with
#   pip install -r pythonEnv/requirements.txt
# driven by installRequiredPythonPackages() in main/utils/pythonEnv.js. Keep
# requirements.txt correct; this script only wraps it in a conda env.
#
# Usage:
#   bash pythonEnv/create_conda_env.sh [env_name] [python_version]
#
# Defaults to python 3.12, which is what the Windows build bundles. macOS and
# Linux builds bundle python 3.9 — pass 3.9 to reproduce those.

set -e

ENV_NAME="${1:-med3pa_app}"
PYTHON_VERSION="${2:-3.12}"

HERE="$(cd "$(dirname "$0")" && pwd)"
CONDA="$(command -v conda || echo conda)"

echo "==> Creating conda environment '$ENV_NAME' (python $PYTHON_VERSION)"
"$CONDA" create -n "$ENV_NAME" "python=$PYTHON_VERSION" -y

# conda ships OpenSSL 3.5.x by default. OpenSSL 3.5 changed the error reported at
# end-of-data when parsing DER certificates from ASN1_R_HEADER_TOO_LONG to
# ASN1_R_NOT_ENOUGH_DATA, and CPython 3.9's _ssl.c only recognises the old reason
# as a clean EOF — so on Windows ssl.create_default_context() dies while loading
# the cert store, and every pip download fails. Harmless on 3.12, required on 3.9.
echo "==> Pinning OpenSSL to 3.0.x"
"$CONDA" install -n "$ENV_NAME" "openssl=3.0.20" -y

ENV_PREFIX="$("$CONDA" run -n "$ENV_NAME" python -c 'import sys, os; print(os.path.dirname(sys.executable))')"
if [ -f "$ENV_PREFIX/python.exe" ]; then
  PY="$ENV_PREFIX/python.exe"
else
  PY="$ENV_PREFIX/python"
fi
echo "==> Using interpreter: $PY"

echo "==> Installing requirements"
"$PY" -m pip install --no-cache-dir -r "$HERE/requirements.txt"

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
