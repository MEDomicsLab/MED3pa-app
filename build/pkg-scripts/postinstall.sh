#!/bin/bash
# macOS pkg post-install: install this app's python requirements into the
# bundled python environment.
#
# Adapted from MEDomicsLab. Two things had to change for the standalone app:
#   - it looks for MED3pa.app (electron-builder productName), not MEDomics.app
#   - the fallback no longer downloads MEDomicsLab's merged_requirements.txt
#     from GitHub. That file lists the whole platform's dependencies and has
#     nothing to do with MED3pa; the requirements shipped inside this bundle
#     are the only correct source.
LOG_FILE=/tmp/med3pa_postinstall.log

# Default configuration directory (shared convention with MEDomicsLab: ~/.medomics)
MEDOMICS_DIR=~/.medomics

# Name of the requirements file
REQUIREMENTS_FILE=merged_requirements.txt

# Function to locate the MED3pa installation path
find_med3pa_path() {
    if [ -d "/Applications/MED3pa.app" ]; then
        echo "/Applications/MED3pa.app"
    elif [ -d "$HOME/Applications/MED3pa.app" ]; then
        echo "$HOME/Applications/MED3pa.app"
    else
        echo ""
    fi
}

MED3PA_PATH=$(find_med3pa_path)

if [ -z "$MED3PA_PATH" ]; then
    echo "MED3pa installation not found; cannot locate the bundled requirements." >>$LOG_FILE
    echo "Debug: Listing all applications in /Applications" >>$LOG_FILE
    ls -l /Applications >>$LOG_FILE
    echo "Postinstall script aborted: install MED3pa.app first, then re-run." >>$LOG_FILE
    exit 0
fi

REQUIREMENTS_FULL_PATH="$MED3PA_PATH/Contents/Resources/pythonEnv/$REQUIREMENTS_FILE"

echo "Checking if $REQUIREMENTS_FULL_PATH exists" >>$LOG_FILE
if [ -f "$REQUIREMENTS_FULL_PATH" ]; then
    echo "Found requirements file at $REQUIREMENTS_FULL_PATH" >>$LOG_FILE

    # Check if pip3 exists in the specified directory
    if [ -f "$MEDOMICS_DIR/python/bin/pip3" ]; then
        echo "Installing requirements from $REQUIREMENTS_FULL_PATH" >>$LOG_FILE
        $MEDOMICS_DIR/python/bin/pip3 install -r "$REQUIREMENTS_FULL_PATH" >>$LOG_FILE 2>&1
        if [ $? -eq 0 ]; then
            echo "Requirements installed successfully." >>$LOG_FILE
        else
            echo "Failed to install requirements." >>$LOG_FILE
        fi
    else
        echo "pip3 not found in $MEDOMICS_DIR/python/bin" >>$LOG_FILE
    fi
else
    echo "Requirements file $REQUIREMENTS_FULL_PATH not found." >>$LOG_FILE
fi

echo "Postinstall script completed" >>$LOG_FILE

exit 0
