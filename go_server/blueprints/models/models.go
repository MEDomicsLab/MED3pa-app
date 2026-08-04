package models

import (
	Utils "go_module/src"
	"log"
)

var prePath = "models"

// AddHandleFunc adds the specific module handle function to the server
func AddHandleFunc() {
	Utils.CreateHandleFunc(prePath+"/import_external_model/", handleImportExternalModel)
	Utils.CreateHandleFunc(prePath+"/progress/", handleProgress)
}

// handleImportExternalModel handles the request to import a model trained
// outside of the application (ONNX, pickle or joblib) as a .medmodel
// It returns the response from the python script
func handleImportExternalModel(jsonConfig string, id string) (string, error) {
	log.Println("Importing external model...", id)
	response, err := Utils.StartPythonScripts(jsonConfig, "../pythonCode/modules/models/import_external_model.py", id)
	Utils.RemoveIdFromScripts(id)
	if err != nil {
		return "", err
	}
	return response, nil
}

// handleProgress handles the request to get the progress of the import
// It returns the progress of the running script
func handleProgress(jsonConfig string, id string) (string, error) {
	Utils.Mu.Lock()
	progress := Utils.Scripts[id].Progress
	Utils.Mu.Unlock()
	if progress != "" {
		return progress, nil
	} else {
		return "{\"now\":\"0\", \"currentLabel\":\"Warming up\"}", nil
	}
}
