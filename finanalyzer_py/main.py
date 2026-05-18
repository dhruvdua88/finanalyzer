"""
FinAnalyzer – Python edition
Entry point: creates the MainApp window and runs the event loop.
"""
import sys
import os

# Ensure the finanalyzer_py directory is on the path when run from the repo root
sys.path.insert(0, os.path.dirname(__file__))

from app.main_app import MainApp


def main() -> None:
    app = MainApp()
    app.mainloop()


if __name__ == "__main__":
    main()
