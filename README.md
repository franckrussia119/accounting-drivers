# 🚛 TRANS-FLOTTE — Comptabilité Chauffeurs & Maintenance de Flotte (10 Camions)

Application web de gestion comptable des chauffeurs et de suivi rigoureux des coûts de maintenance et de carburant pour une entreprise de transport routier exploitant une flotte de 10 camions.

Conçue avec une interface moderne inspirée des applications Fintech, 100% en Français, entièrement réactive (les tableaux se transforment en cartes empilées sur smartphone pour une saisie rapide à une main sur le terrain) avec basculement automatique du mode sombre / clair.

---

## 🚀 Architecture & Stack Technique

- **Backend** : Node.js (v22+) + Express
- **Stockage de données** : Fichier unique SQLite stocké dans le dossier `/data/flotte.db` via `better-sqlite3` (avec repli automatique sur le moteur natif `node:sqlite`). Aucun serveur de base de données externe requis !
- **Frontend** : Page HTML unique réactive avec JavaScript Vanilla pur (sans React, sans étape de build complexe), communiquant via une API REST JSON sécurisée.
- **Authentification** : Cookie de session signé `HttpOnly` avec écran de connexion sécurisé.
- **Déploiement** : Prêt pour **Coolify** (PaaS auto-hébergé) ou Docker standard grâce au `Dockerfile` inclus.

---

## 📋 Modèle de Données & Fonctionnalités

1. **Chauffeurs (Salariés & Sous-traitants)** :
   - Gestion de la liste avec **édition directement en ligne (inline)** sans dialogue intrusif `prompt()`.
   - Nom, camion assigné (TR-01 à TR-10), statut sous-traitant/salarié, indicateur actif/inactif, téléphone.
   - **Compte individuel détaillé** :
     - Nombre de voyages sur une plage de dates sélectionnable.
     - Total des recettes perçues (FCFA).
     - Total dépensé en carburant (FCFA et litres).
     - Total dépensé en réparations & entretiens sur le(s) camion(s) conduit(s).
     - Total des **autres dépenses** (péage, amende, assurance, parking, douane, etc.).
     - **Solde Net** mis en évidence : `Recettes - Carburant - Entretien - Autres Dépenses`.
     - Flux chronologique unifié de toutes les opérations.
     - **Analyse graphique** : évolution mensuelle recettes vs dépenses, et répartition des coûts par catégorie.
     - Export CSV individuel du relevé de compte.
     - **Export PDF** du relevé de compte (bouton "Exporter en PDF", utilise l'impression du navigateur — fonctionne sur ordinateur comme sur mobile, sans dépendance externe).

2. **Tableau de Bord Entreprise (Dashboard)** :
   - Indicateurs clés : Recettes totales, Carburant total, Entretien total, Autres Dépenses, Bénéfice Net de la flotte et Marge opérationnelle.
   - Graphique interactif mensuel (Recettes vs Charges vs Solde Net).
   - Tableau comparatif des 10 camions avec décomposition des coûts et bénéfice par véhicule.

3. **Camions & Entretien (10 Camions)** :
   - Ajout et modification de camions directement depuis l'interface (bouton "+ Ajouter un camion").
   - Fiche d'identité par camion (code, modèle, immatriculation, kilométrage compteur, chauffeur habituel, statut).
   - Coût total de possession (TCO) et historique complet de toutes les réparations par camion.
   - Répartition des coûts par type d'intervention (Vidange, Freins, Pneus, Révision, Panne, etc.).

4. **Voyages (Trips)** :
   - Enregistrement des trajets (chauffeur, camion, date, itinéraire, marchandise, N° BL, N° Conteneur, montant reçu en FCFA, notes).

5. **Carburant (Fuel)** :
   - Saisie des pleins (chauffeur, camion, date, litres, montant payé en FCFA, station/lieu, kilométrage).
   - Mise à jour automatique du kilométrage du camion.

6. **Entretien & Réparations** :
   - Enregistrement des interventions d'atelier (camion, chauffeur, date, type sélectionnable ou personnalisé, description des pièces et travaux, garage, montant en FCFA, kilométrage).

7. **Autres Dépenses** (péage, amende, assurance, parking, douane, chargement, ou catégorie personnalisée) :
   - Permet d'enregistrer toute dépense liée à un chauffeur ou un camion qui n'est ni carburant ni entretien atelier, avec date, description et montant.
   - Incluses automatiquement dans le solde net du chauffeur et dans le tableau de bord entreprise.

8. **Filtres de dates & Exports** :
   - Préréglages rapides : *Cette semaine*, *Ce mois-ci*, *7 derniers jours*, *30 derniers jours*, *Tout afficher*.
   - Sélecteurs personnalisés *Du / Au*.
   - Export CSV compatible Microsoft Excel (encodage UTF-8 BOM et séparateur point-virgule `;`).
   - Export PDF du relevé de compte chauffeur (via impression navigateur).

---

## ⚙️ Variables d'Environnement

Configurez les variables suivantes dans votre fichier `.env` ou dans l'interface de Coolify :

> ⚠️ **Changez `AUTH_PASSWORD` et `SESSION_SECRET` avant tout déploiement accessible publiquement.** Les valeurs par défaut ne sont là que pour un premier test local.

| Variable | Description | Valeur par défaut |
| :--- | :--- | :--- |
| `AUTH_USERNAME` | Nom d'utilisateur administrateur | `admin` |
| `AUTH_PASSWORD` | Mot de passe de connexion | `changeme123` |
| `SESSION_SECRET` | Clé secrète pour signer le cookie HttpOnly | `changez-ce-secret-en-production` |
| `DATABASE_PATH` | Emplacement du fichier SQLite | `./data/flotte.db` |
| `PORT` | Port d'écoute du serveur web | `3000` |

---

## 💻 Démarrage Local

### Prérequis
- Node.js version 18 ou plus récente

### Installation
```bash
# 1. Cloner le dépôt
git clone <url-du-repo>
cd gestion-flotte-chauffeurs

# 2. Installer les dépendances
npm install

# 3. Copier les variables d'environnement
cp .env.example .env

# 4. Lancer le serveur de développement
npm run dev
```

Ouvrez ensuite votre navigateur sur : **`http://localhost:3000`**  
Connectez-vous avec les identifiants par défaut : **`admin`** / **`changeme123`** (ou ceux que vous avez définis dans `.env`).

> La base de données démarre **complètement vide** — aucune donnée de démonstration. Ajoutez vos vrais camions et chauffeurs depuis l'application elle-même.

---

## 📤 Mettre le code sur GitHub

```bash
cd gestion-flotte-chauffeurs
git init
git add .
git commit -m "Version initiale"
git branch -M main
git remote add origin https://github.com/<votre-nom>/<votre-repo>.git
git push -u origin main
```

(Créez d'abord un dépôt vide sur GitHub — sans README ni .gitignore, puisque le projet en a déjà — puis lancez les commandes ci-dessus.)

---

## 🐳 Déploiement sur Coolify (PaaS Auto-hébergé)

Coolify permet de déployer l'application en quelques secondes directement depuis un dépôt GitHub.

### Étape 1 : Créer une nouvelle application dans Coolify
1. Dans votre instance Coolify, cliquez sur **+ New Resource** > **Application**.
2. Sélectionnez **Public Repository** ou **Private Repository (GitHub App)** et collez l'URL de votre dépôt.
3. Choisissez la branche (ex: `main`).

### Étape 2 : Configuration du Build
- **Build Pack** : Sélectionnez **Dockerfile**.
- **Port d'écoute** : Renseignez `3000`.

### Étape 3 : ⚠️ Montage d'un Volume Persistant (CRITIQUE pour SQLite)
> **Important :** Pour que votre base de données SQLite ne soit pas effacée lors des redéploiements ou mises à jour de code, vous **DEVEZ** attacher un volume persistant au dossier `/app/data`.

1. Dans l'onglet **Storages / Persistent Storage** de votre application Coolify :
2. Ajoutez un nouveau stockage :
   - **Name** : `flotte_data`
   - **Destination Path** : `/app/data`
3. Sauvegardez la configuration.

### Étape 4 : Variables d'Environnement
Dans l'onglet **Environment Variables**, définissez vos identifiants personnalisés :
```env
AUTH_USERNAME=votre_identifiant
AUTH_PASSWORD=votre_mot_de_passe_securise
SESSION_SECRET=cle_secrete_aleatoire_tres_longue_12345
DATABASE_PATH=/app/data/flotte.db
PORT=3000
```

### Étape 5 : Déploiement
Cliquez sur **Deploy**. Coolify construira l'image Docker avec `better-sqlite3`, montera le volume persistant `/app/data` et démarrera le conteneur.

---

## 💾 Sauvegarde de la Base de Données

La base de données étant un unique fichier SQLite (`flotte.db`), vous pouvez la sauvegarder à tout moment par simple copie de fichier :
```bash
# Sauvegarde manuelle
cp /chemin/vers/data/flotte.db /chemin/vers/backup/flotte_$(date +%F).db
```
Ou en téléchargeant le fichier depuis le volume persistant de Coolify.
