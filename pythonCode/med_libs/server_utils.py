import os
import sys
from pathlib import Path
from json import dumps


def get_repo_path():
    """
    Gets the path of the repository
    """
    return str(Path(os.path.dirname(os.path.abspath(__file__))).parent.parent)


def go_print(msg):
    """
    This function is used to print a message to the stdout pipeline wich go is listening to
    """
    sys.stdout.flush()
    sys.stdout.write(dumps(msg, indent=2))
    sys.stdout.write("\n")
    sys.stdout.flush()


def find_next_available_port(start_port: int = 5001) -> int:
    """
        This function is used to find the next available port
    """
    port = start_port
    while is_port_in_use(port):
        port += 1
    return port


def is_port_in_use(port: int) -> bool:
    """
        This function is used to check if a port is in use
    """
    go_print(f"checking port {port}")
    import socket
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(('localhost', port)) == 0


def get_free_space_mb(folder):
    """
        This function is used to get the free space in a folder
    """
    import shutil
    total, used, free = shutil.disk_usage(folder)
    return free / (1024.0 ** 3)


def get_model_from_path(path: str):
    """
        This function is used to get the model from a medmodel
    """
    import joblib

    with open(path, "rb") as f:
        model = joblib.load(f)
    if hasattr(model, "steps"):
        model = model.steps[-1][1]
    return model


def load_csv(path: str, target: str):
    """
        This function is used to load a csv file

        Args:
            path: The path of the csv file
            target: The target column name
    """
    import pandas as pd

    df = pd.read_csv(path)
    temp_df = df[df[target].notna()]
    temp_df.replace("", float("NaN"), inplace=True)
    temp_df.dropna(how='all', axis=1, inplace=True)
    return temp_df
