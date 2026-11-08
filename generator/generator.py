import argparse
import datetime
import math
import random
import time
import requests

# Konfiguracja parametrów linii poleceń (F13, T11)
parser = argparse.ArgumentParser(
    description="Generator i emulator czujnika IoT dla łowiska"
)
parser.add_argument(
    "--url",
    default="http://localhost:3000/api/measurements",
    help="Adres URL endpointu pomiarów",
)
parser.add_argument(
    "--key",
    required=True,
    help="Klucz API czujnika uzyskany przy rejestracji (nagłówek X-API-Key)",
)
parser.add_argument(
    "--type",
    choices=["temp", "pressure", "oxygen"],
    default="temp",
    help="Typ generowanej wielkości",
)
parser.add_argument(
    "--count", type=int, default=15, help="Liczba pomiarów do wysłania"
)
parser.add_argument(
    "--interval", type=float, default=1.0, help="Odstęp czasu w sekundach"
)
parser.add_argument(
    "--historical",
    action="store_true",
    help="Generuj punkty z przeszłości (dane przykładowe F11)",
)
parser.add_argument(
    "--out-of-range",
    action="store_true",
    help="Wymuś błędną wartość spoza zakresu do testów walidacji (F4)",
)
args = parser.parse_args()

headers = {"X-API-Key": args.key, "Content-Type": "application/json"}
now = datetime.datetime.now(datetime.timezone.utc)

print(
    f"[GENERATOR] Rozpoczynam wysyłanie {args.count} punktów ({args.type}) do {args.url}..."
)

for i in range(args.count):
    # Wyznaczanie znacznika czasu ISO 8601
    if args.historical:
        # Generujemy punkty wstecz (np. co 15 minut)
        timestamp = (
            now - datetime.timedelta(minutes=(args.count - i) * 15)
        ).isoformat()
    else:
        timestamp = datetime.datetime.now(datetime.timezone.utc).isoformat()

    # Symulacja wartości (funkcje sinusoidalne + losowy szum)
    if args.type == "temp":
        # Zakres serii: 0 - 35 °C
        base = 18.0 + 4.0 * math.sin(i / 3.0) + random.uniform(-0.3, 0.3)
        val = 99.0 if args.out_of_range else round(base, 2)

    elif args.type == "pressure":
        # Zakres serii: 950 - 1060 hPa
        base = 1012.0 + 5.0 * math.sin(i / 5.0) + random.uniform(-0.5, 0.5)
        val = 500.0 if args.out_of_range else round(base, 1)

    elif args.type == "oxygen":
        # Zakres serii: 0 - 15 mg/l
        base = 8.5 + 1.2 * math.sin(i / 2.5) + random.uniform(-0.2, 0.2)
        val = -5.0 if args.out_of_range else round(base, 2)

    payload = {"value": val, "timestamp": timestamp}

    try:
        res = requests.post(args.url, json=payload, headers=headers)
        if res.status_code == 201:
            print(f"[OK 201] Zapisano pomiar: {val} o {timestamp}")
        elif res.status_code == 422:
            print(
                f"[F4 SUKCES WALIDACJI: 422 Unprocessable] Serwer prawidłowo odrzucił wartość {val}: {res.text}"
            )
        elif res.status_code == 401:
            print(
                f"[401 Unauthorized] Odrzucono: niepoprawny lub wyrejestrowany klucz API"
            )
        else:
            print(f"[{res.status_code}] Odpowiedź serwera: {res.text}")
    except Exception as e:
        print(f"[BŁĄD POŁĄCZENIA]: {e}")

    if not args.historical and i < args.count - 1:
        time.sleep(args.interval)

print("[GENERATOR] Zakończono generowanie.")