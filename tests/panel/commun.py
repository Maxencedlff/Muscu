"""Ce que partagent le moteur (capture_parcours.py) et les parcours (parcours.py)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from fixtures import PARIS, local_ms  # noqa: E402

# Horloge figée : mercredi 4 novembre 2026, 18 h 30 à Paris (les données sont calculées depuis cet instant)
NOW = local_ms(2026, 11, 4, 18, 30, tz=PARIS)


class Absent(Exception):
    """Écran ou élément introuvable : l'étape est notée « absent », le parcours continue."""
