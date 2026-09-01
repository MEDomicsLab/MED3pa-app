@echo off
REM ---------------------------------------------------------------------------
REM Build the conda environment for the MED3pa standalone app (Windows).
REM
REM Mirrors pythonEnv/create_conda_env.sh. This is DEVELOPER tooling: the
REM packaged app does not run it, and installs into its own bundled python via
REM installRequiredPythonPackages() in main/utils/pythonEnv.js instead.
REM
REM Usage:
REM   pythonEnv\create_conda_env.bat [env_name] [python_version]
REM
REM Ordering matters: numpy is pinned BEFORE MED3pa, because installing MED3pa
REM unpinned drags in numpy 2.x and scipy 1.18, which then conflict with
REM MED3pa's own numpy<2.1.0 requirement. scipy is pinned back afterwards for
REM the same reason.
REM
REM Python 3.12 is required, not merely preferred: MED3pa uses typing.Self
REM (3.11+) and PEP 604 unions, and pins checkpointer behind a
REM python_version >= "3.12" marker.
REM ---------------------------------------------------------------------------

setlocal enabledelayedexpansion

set "ENV_NAME=%~1"
if "%ENV_NAME%"=="" set "ENV_NAME=med3pa_app"

set "PYTHON_VERSION=%~2"
if "%PYTHON_VERSION%"=="" set "PYTHON_VERSION=3.12"

set "HERE=%~dp0"

where conda >nul 2>&1
if errorlevel 1 (
    echo ERROR: conda was not found on PATH.
    echo Install Miniconda/Anaconda, or run this from an Anaconda Prompt.
    exit /b 1
)

REM Refuse to touch an existing environment. `conda create -y` recreates the
REM prefix, so running this with the default name against an env you already
REM depend on destroys it.
call conda env list | findstr /R /C:"^%ENV_NAME% " >nul 2>&1
if not errorlevel 1 (
    echo ERROR: a conda environment named "%ENV_NAME%" already exists.
    echo Pick another name, or remove it first with:
    echo     conda env remove -n %ENV_NAME%
    exit /b 1
)

echo ==^> Creating conda environment "%ENV_NAME%" ^(python %PYTHON_VERSION%^)
call conda create -n "%ENV_NAME%" "python=%PYTHON_VERSION%" -y
if errorlevel 1 exit /b 1

REM conda ships OpenSSL 3.5 by default. OpenSSL 3.5 changed the error reported at
REM end-of-data when parsing DER certificates, and CPython 3.9's _ssl.c only
REM recognises the old reason as a clean EOF, so ssl.create_default_context()
REM dies while loading the Windows cert store and every pip download fails.
REM Harmless on 3.12, required on 3.9.
echo ==^> Pinning OpenSSL to 3.0.x
call conda install -n "%ENV_NAME%" "openssl=3.0.20" -y
if errorlevel 1 exit /b 1

REM Resolve the interpreter inside the environment rather than assuming a path,
REM since conda may live under any prefix.
for /f "delims=" %%i in ('conda run -n "%ENV_NAME%" python -c "import sys; print(sys.executable)"') do set "PY=%%i"
if not defined PY (
    echo ERROR: could not locate the python interpreter for "%ENV_NAME%".
    exit /b 1
)
echo ==^> Using interpreter: %PY%

echo ==^> Pinning numpy first
"%PY%" -m pip install --no-cache-dir "numpy==1.26.4"
if errorlevel 1 exit /b 1

echo ==^> Installing requirements
"%PY%" -m pip install --no-cache-dir -r "%HERE%requirements.txt"
if errorlevel 1 exit /b 1

echo ==^> Restoring the numpy / scipy pins that MED3pa's install overrode
"%PY%" -m pip install --no-cache-dir --force-reinstall "numpy==1.26.4"
if errorlevel 1 exit /b 1
"%PY%" -m pip install --no-cache-dir "scipy==1.11.4"
if errorlevel 1 exit /b 1

echo ==^> Verifying
"%PY%" -m pip check
"%PY%" -c "import numpy, pandas, scipy, sklearn, torch, xgboost, onnxruntime, pymongo, joblib; from MED3pa.datasets import DatasetsManager; from MED3pa.med3pa import Med3paExperiment; from MED3pa.med3pa.models import APCModel, IPCModel, MPCModel, MpcStrategy; from MED3pa.med3pa.uncertainty import UncertaintyCalculator, UncertaintyMetric; print('numpy', numpy.__version__, '| pandas', pandas.__version__, '| torch', torch.__version__); print('MED3pa imports OK')"
if errorlevel 1 (
    echo ERROR: the environment was created but MED3pa could not be imported.
    exit /b 1
)

echo.
echo Done. Point the app at this interpreter:
echo   %PY%
echo Set it in the app's System page ^(Python environment path^).

endlocal
