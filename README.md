# Tablica zadań HAL 2027

Masterplan i kanbany patroli (Program, Kwaterka, Organizacja) oraz chroniona tablica HoP.
Strona statyczna (GitHub Pages) + baza Firebase (Firestore i Authentication).

## Struktura

```
index.html              szkielet strony (gniazda wypełniane przez skrypty)
css/style.css           cały wygląd; kolory patroli na górze i w sekcjach
js/config.js            KONFIGURACJA: Firebase, zakres masterplanu, zakładki, kolumny, wiersze
js/main.js              start aplikacji: wybór bazy, nasłuch logowania, pierwszy widok
js/state.js             wspólny stan (store, view, me, tasks, plan) i act() z dziennikiem
js/ui.js                narzędzia: el(), toast(), okna dialogowe, ikony, komunikaty błędów
js/views.js             zakładki, nawigacja #adres, przełączanie widoków
js/plan.js              masterplan: układ wydarzeń, linia „dziś”, edycja wydarzeń
js/kanban.js            kanban: karty, przeciąganie, deadline'y, edycja zadań
js/auth.js              kwadraty logowania, logowanie, wylogowanie
js/admin.js             panel admina: konta, własne hasło, dziennik
js/store/firebase.js    dostęp do prawdziwej bazy
js/store/demo.js        tryb podglądu (localStorage), te same metody co firebase.js
firestore.rules         reguły bezpieczeństwa – wklejane w konsoli Firebase
```

Zależności między modułami idą w jedną stronę:
`main → views/auth → plan/kanban/admin → state → ui → config`.

## Testowanie lokalne

Moduły JavaScript nie działają po dwukliku w plik (adres `file://`). Uruchom w folderze projektu:

```
python -m http.server 8000
```

i otwórz `http://localhost:8000`. Dopóki `apiKey` w `js/config.js` zaczyna się od `WKLEJ`,
działa tryb podglądu (konta testowe: admin / demo, hop / demo).

## Obsługa na telefonie

- Nawigacja widoków jest dostępna z menu hamburgerowego.
- Masterplan pozostaje osią czasu: nagłówki pokazują nazwy miesięcy bez roku
  i bez opisów połówek, których granice nadal są widoczne na osi. Kontrolki
  pozwalają przechodzić między miesiącami bez poziomego przesuwania.
- Na telefonie etykiety patroli są obrócone, a kanban wypełnia dostępną
  wysokość ekranu; listy kart przewijają się wewnątrz kolumn.
- W kanbanie można zmieniać kolumny przez przesuwanie tablicy, przyciski
  poprzednia/następna albo zmianę kolumny w formularzu zadania.
- Dialogi mieszczą się w wysokości ekranu, a formularze i ich przyciski
  pozostają wygodne przy obsłudze dotykowej.
- Przycisk logowania ma stonowaną ikonę wejścia zamiast kłódki.

## Wdrożenie

### A. Firebase
1. console.firebase.google.com → Dodaj projekt (Google Analytics niepotrzebne).
2. Firestore Database → Utwórz bazę → tryb produkcyjny → lokalizacja `europe-central2` (Warszawa). Lokalizacji nie da się później zmienić.
3. Firestore → Reguły → wklej `firestore.rules` → Opublikuj.
4. Authentication → Rozpocznij → Metoda logowania → E-mail/hasło → włącz (tylko pierwszy przełącznik).
5. Ustawienia projektu (koło zębate) → Twoje aplikacje → ikona `</>` → zarejestruj aplikację (bez Hostingu) → skopiuj `apiKey`, `authDomain`, `projectId`, `appId` do `js/config.js`.
6. Authentication → Users → Dodaj użytkownika: `patryk.romanski@hal2027.local` + długie hasło → skopiuj UID.
7. Firestore → Dane → Rozpocznij kolekcję `members` → ID dokumentu = UID z punktu 6 → pola:
   `login` (string) `patryk.romanski`, `role` (string) `admin`, `active` (boolean) `true`.

### B. GitHub Pages
8. Utwórz repozytorium (publiczne – darmowe Pages wymagają publicznego), np. `hal2027`.
9. Wgraj zawartość folderu z zachowaniem struktury (Add file → Upload files, przeciągnij foldery `css` i `js` oraz pliki).
10. Settings → Pages → Deploy from a branch → `main` / `(root)` → Save. Po 1–2 minutach strona działa pod `https://LOGIN.github.io/hal2027/`. Zaznacz „Enforce HTTPS”.
11. Otwórz stronę: nie powinno być paska „Tryb podglądu”. Zaloguj się jako admin i załóż konta HoP w panelu.

### C. SharePoint
12. Dodaj `LOGIN.github.io` (dokładnie ten adres) do dozwolonych domen osadzania (HTML Field Security – może to wymagać admina witryny).
13. Edytuj stronę → web part Osadzanie → kod:
    `<iframe src="https://LOGIN.github.io/hal2027/#plan" width="100%" height="800" style="border:0"></iframe>`
    (zamiast `#plan` można dać `#program`, `#kwaterka`, `#organizacja`).
14. Sprawdź logowanie HoP wewnątrz SharePointa.

### D. Zabezpieczenia kont
15. Weryfikacja dwuetapowa na koncie Google (Firebase) i GitHub.
16. Opcjonalnie: Google Cloud Console → Interfejsy API → Dane logowania → klucz przeglądarki → ogranicz odwołujące witryny do `https://LOGIN.github.io/*` i `http://localhost:8000/*`.

## Aktualizacje
- Zmiany w stronie: edytuj pliki, przetestuj lokalnie, wgraj na GitHuba. Pages odświeża się w 1–2 minuty, przeglądarka może trzymać starą wersję do ok. 10 minut (Ctrl+F5 wymusza odświeżenie).
- Zmiany w modelu danych: najpierw opublikuj nowe `firestore.rules`, potem nową stronę.

## Rozwiązywanie problemów

Jeśli strona nie wystartuje, zamiast pustej strony pokaże komunikat z przyczyną:

- **„Strona została otwarta bezpośrednio z dysku”** – uruchom lokalny serwer (`python -m http.server 8000`).
- **„Nie udało się wczytać plików aplikacji”** – na serwerze brakuje pliku lub folderu (sprawdź `css/`, `js/`, `js/store/`).
- **„Błąd podczas uruchamiania aplikacji … (js/config.js, linia N)”** – literówka w pliku, najczęściej w konfiguracji Firebase (brakujący przecinek lub cudzysłów).
- **„Nie udało się połączyć z bazą danych”** – zła konfiguracja Firebase albo brak internetu.
- **„Brak dostępu do danych”** – reguły z `firestore.rules` nie są opublikowane.
- **Strona działa pod własnym adresem, ale nie w SharePoincie** – problem po stronie osadzenia (dozwolone domeny, blokada skryptów w ramce).

Po wgraniu nowej wersji zmień wartość `?v=…` przy `style.css` i `main.js` w `index.html`. GitHub Pages i przeglądarki trzymają pliki w pamięci podręcznej do ok. 10 minut; w razie wątpliwości odśwież stronę przez Ctrl+F5.
