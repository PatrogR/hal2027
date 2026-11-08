# Tablica zadań HAL 2027

Masterplan i kanbany patroli (Program, Kwaterka, Organizacja) oraz chroniona tablica HoP.
Strona statyczna (GitHub Pages) + Firebase (Firestore i Authentication).

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
firestore.rules         reguły Firestore – wklejane w konsoli Firebase
firebase.json           konfiguracja wdrażania reguł Firestore
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

Wspólne hasło jest jedynie ekranem wejściowym po stronie przeglądarki. Domyślne
hasło (`macandcheese`) znajduje się w `js/config.js`; admin może ustawić inne,
które jest przechowywane jawnie w Firestore. Każdy może podejrzeć hasło lub
ominąć ekran, więc nie traktuj go jako ochrony danych.

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
- Po zalogowaniu HoP jest widoczna czerwona plakietka statusu zamiast ramki
  wokół całej strony; administratora oznacza ikona panelu.
- Etykieta „Organizacja” w masterplanie skraca się do „Org.”, jeśli pełna
  nazwa nie mieści się w dostępnej przestrzeni.
- Na desktopie miesiące są rozłożone równomiernie i wyśrodkowane w nagłówku,
  a etykiety patroli wypełniają wysokość wiersza masterplanu.

## Uprawnienia zadań kanban

- Goście mogą tworzyć i edytować zadania oraz przenosić je między kolumnami
  do „Do sprawdzenia”. Przy tworzeniu aplikacja prosi o potwierdzenie zapisu;
  goście nie mogą usuwać zadań.
- HoP i administratorzy mogą zatwierdzać zadania z „Do sprawdzenia” do
  „Gotowe”, anulować zatwierdzenie w formularzu zadania oraz usuwać zadania.
  Te ograniczenia są sprawdzane również przez
  `firestore.rules`, nie tylko przez interfejs.

## Wdrożenie

### A. Firebase
1. console.firebase.google.com → Dodaj projekt (Google Analytics niepotrzebne).
2. Firestore Database → Utwórz bazę → tryb produkcyjny → lokalizacja `europe-central2` (Warszawa). Lokalizacji nie da się później zmienić.
3. Authentication → Rozpocznij → Metoda logowania → włącz Email/Password.
4. Ustawienia projektu (koło zębate) → Twoje aplikacje → ikona `</>` → zarejestruj aplikację (bez Hostingu) → skopiuj `apiKey`, `authDomain`, `projectId`, `appId` do `js/config.js`.
5. Authentication → Users → Dodaj użytkownika: `patryk.romanski@hal2027.local` + długie hasło → skopiuj UID.
6. Firestore → Dane → Rozpocznij kolekcję `members` → ID dokumentu = UID z punktu 5 → pola:
   `login` (string) `patryk.romanski`, `role` (string) `admin`, `active` (boolean) `true`.
7. Plan Blaze ani Cloud Functions nie są potrzebne. Przed publikacją reguł otwórz Firestore → Dane → `settings/appAccess`. Jeśli dokument istnieje ze starej konfiguracji, usuń z niego pola `version`, `salt` i `passwordHash`; dodaj pole `password` typu string (np. `macandcheese`). Jeśli dokumentu nie ma, aplikacja użyje hasła domyślnego z `js/config.js`.
8. Otwórz Firestore → Reguły, wklej zawartość `firestore.rules` i kliknij Opublikuj. Możesz też użyć Firebase CLI: `firebase deploy --only firestore:rules --project hal-2027-7ldw`.
9. Po otwarciu strony wpisz aktualne wspólne hasło, zaloguj się jako admin i w panelu admina zmień je w sekcji „Hasło dostępu do aplikacji”. Zapis w Firestore zastępuje wartości ze starej konfiguracji.
10. Wspólne hasło zapisuje się jawnie w Firestore i jest dostępne w kodzie klienta. Zmiana działa dla nowych sesji; bieżąca sesja karty pozostaje odblokowana do jej zamknięcia.

### B. GitHub Pages
11. Utwórz repozytorium (publiczne – darmowe Pages wymagają publicznego), np. `hal2027`.
12. Wgraj zawartość folderu z zachowaniem struktury (Add file → Upload files, przeciągnij foldery `css` i `js` oraz pliki).
13. Settings → Pages → Deploy from a branch → `main` / `(root)` → Save. Po 1–2 minutach strona działa pod `https://LOGIN.github.io/hal2027/`. Zaznacz „Enforce HTTPS”.
14. Otwórz stronę, wpisz wspólne hasło aplikacji, zaloguj się jako admin i załóż konta HoP w panelu.

### C. SharePoint
15. Dodaj `LOGIN.github.io` (dokładnie ten adres) do dozwolonych domen osadzania (HTML Field Security – może to wymagać admina witryny).
16. Edytuj stronę → web part Osadzanie → kod:
    `<iframe src="https://LOGIN.github.io/hal2027/#plan" width="100%" height="800" style="border:0"></iframe>`
    (zamiast `#plan` można dać `#program`, `#kwaterka`, `#organizacja`).
17. Sprawdź wspólne hasło aplikacji oraz logowanie HoP wewnątrz SharePointa.

### D. Zabezpieczenia kont
18. Weryfikacja dwuetapowa na koncie Google (Firebase) i GitHub.
19. Opcjonalnie: Google Cloud Console → Interfejsy API → Dane logowania → klucz przeglądarki → ogranicz odwołujące witryny do `https://LOGIN.github.io/*` i `http://localhost:8000/*`.

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
