# M4X Sourcing 2.0 — mise en ligne (GitHub + Cloudflare)

Plateforme de recrutement en ingénierie éditée par M4X Design.
Version 1 publique : comptes, inscriptions candidats / entreprises / cabinets, CV + photo + dossier, justificatifs, offres, filtres, matching, messagerie, période d'essai et promotions, Admin, pages légales.

**Coût au démarrage : 0 €** (offres gratuites GitHub et Cloudflare). Durée de mise en ligne : environ 1 heure en suivant ce guide.

---

## Contenu du dossier

| Élément | Rôle |
|---|---|
| `public/index.html` | Le site (toutes les pages) |
| `functions/api/[[path]].js` | Le serveur : comptes, règles d'accès, essai/promo, fichiers |
| `schema.sql` | Création des tables de la base de données |
| `wrangler.toml` | Configuration Cloudflare (base + stockage) |
| `dev/server.mjs` | Simulateur local pour tester sur votre ordinateur (facultatif) |

---

## Étape 1 — Créer les comptes (gratuits)

1. **GitHub** : https://github.com/signup
2. **Cloudflare** : https://dash.cloudflare.com/sign-up
   L'activation du stockage de fichiers R2 peut demander d'enregistrer un moyen de paiement, même pour l'offre gratuite (10 Go inclus, largement suffisant au démarrage).

## Étape 2 — Mettre le code sur GitHub

1. Sur GitHub : **New repository** → nom `m4x-sourcing` → cochez **Private** → **Create repository**.
2. Cliquez sur **uploading an existing file**, puis glissez-déposez **tout le contenu** du dossier `m4x-sourcing` (dossiers `public`, `functions`, `dev` et les fichiers `schema.sql`, `wrangler.toml`, `README.md`, `.gitignore`).
3. **Commit changes**.

## Étape 3 — Créer la base de données (Cloudflare D1)

1. Tableau de bord Cloudflare → **Storage & Databases** → **D1 SQL Database** → **Create**.
2. Nom : `m4x-sourcing-db` · Emplacement : **Western Europe (weur)** → **Create**.
3. Copiez le **Database ID** affiché (suite de lettres et chiffres).
4. Onglet **Console** de la base : collez tout le contenu de `schema.sql`, puis **Execute**.
5. Sur GitHub, ouvrez `wrangler.toml` → icône crayon → remplacez `REMPLACER-PAR-VOTRE-DATABASE-ID` par votre Database ID → **Commit changes**.

## Étape 4 — Créer le stockage des fichiers (Cloudflare R2)

1. Tableau de bord → **R2 Object Storage** → **Create bucket**.
2. Nom : `m4x-sourcing-files` · Emplacement : **Automatic** ou **Europe (EU)** → **Create bucket**.
   Laissez le bucket **privé** : les fichiers ne sont servis que par le site, avec contrôle des droits.

## Étape 5 — Publier le site (Cloudflare Pages)

1. Tableau de bord → **Workers & Pages** → **Create** → onglet **Pages** → **Connect to Git**.
2. Autorisez GitHub, choisissez le dépôt `m4x-sourcing` → **Begin setup**.
3. Réglages de build :
   - Framework preset : **None**
   - Build command : *(laisser vide)*
   - Build output directory : `public`
4. **Save and Deploy**. Après 1 à 2 minutes, le site est en ligne sur `https://m4x-sourcing.pages.dev` (ou un nom proche).

La base D1 et le stockage R2 sont reliés automatiquement grâce au fichier `wrangler.toml`. Ce fichier fait foi : les liaisons ne se modifient plus dans le tableau de bord.

## Étape 6 — Vous déclarer administrateur

1. Projet Pages → **Settings** → **Variables and Secrets** → **Add** :
   - Type : **Secret** · Nom : `ADMIN_EMAILS` · Valeur : votre adresse e-mail.
2. **Deployments** → sur le dernier déploiement, **⋯** → **Retry deployment** (pour prendre en compte le secret).
3. Sur le site, cliquez sur **Connexion** → **Créer un compte** avec cette adresse : l'onglet **Admin** apparaît.

## Étape 7 — Votre adresse personnalisée (facultatif)

Projet Pages → **Custom domains** → **Set up a custom domain** → par exemple `sourcing.m4xdesign.business`.
Si le domaine est géré par Cloudflare, tout est automatique. Sinon, Cloudflare indique l'enregistrement DNS (CNAME) à ajouter chez votre registrar.

## Étape 8 — E-mails « mot de passe oublié » (facultatif, recommandé)

Sans cette étape, un utilisateur qui a oublié son mot de passe vous écrit, et vous créez un mot de passe provisoire depuis **Admin → Comptes utilisateurs**.

Pour l'envoi automatique d'un lien de réinitialisation :
1. Créez un compte sur https://resend.com (offre gratuite suffisante au démarrage) et validez votre domaine `m4xdesign.business`.
2. Créez une clé API, puis dans Cloudflare ajoutez le **Secret** `RESEND_API_KEY`.
3. Vérifiez `MAIL_FROM` dans `wrangler.toml` (adresse d'expédition sur votre domaine validé).
4. Redéployez.

## Étape 9 — Traduction des messages avec DeepL (facultatif, recommandé)

1. Compte gratuit sur https://www.deepl.com/pro-api (offre **DeepL API Free**, 500 000 caractères par mois).
2. Dans votre compte DeepL, onglet **Clés API** : copiez la clé d'authentification (elle ressemble à `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx:fx`).
3. Cloudflare → projet Pages → **Settings** → **Variables and Secrets** → **Add** : Type **Secret**, nom `DEEPL_API_KEY`, valeur = la clé.
4. **Deployments** → dernier déploiement → **⋯** → **Retry deployment**.

La case « Traduire automatiquement les messages reçus » apparaît alors dans la messagerie. Chaque message n'est traduit qu'une fois (mise en cache), dans la langue choisie par le lecteur.

---

## Premiers réglages dans l'Admin

- **Essai gratuit** : actif jusqu'au 30/11/2026, prolongeable (+15 j, +1 mois, +3 mois).
- **Promotion premiers inscrits** : jusqu'au 15/12/2026 — 6 mois pour les 500 premiers individus, 4 mois pour les 50 premières entreprises.
- **Annonces gratuites** : cochées tant que le paiement en ligne n'est pas actif.
- **Valider les justificatifs** des entreprises (bouton *Valider*) : c'est ce qui leur permet de publier des offres.
- **Activer 1 an** : après réception d'un virement, active l'abonnement d'un candidat ou d'une entreprise et enregistre le paiement.

## Mettre à jour le site

Modifiez un fichier sur GitHub (icône crayon) → **Commit changes** : Cloudflare republie le site automatiquement en 1 à 2 minutes. Les données (comptes, profils, fichiers) ne sont pas touchées.

## Sauvegardes

D1 conserve un historique de la base (« Time Travel ») qui permet de revenir à un état antérieur récent (7 jours avec l'offre gratuite, 30 jours avec l'offre payante). Pour une copie manuelle : D1 → votre base → **Export**.

## Tester sur votre ordinateur (facultatif)

Avec Node.js 22 installé : `node dev/server.mjs` puis ouvrez http://localhost:8788
(compte administrateur local : inscrivez-vous avec `admin@test.fr`). Les données de test sont effacées à l'arrêt.

---

## Sécurité intégrée

- Mots de passe chiffrés (PBKDF2, 100 000 itérations), sessions sécurisées (cookie HttpOnly, Secure), blocage après 8 essais erronés.
- Toutes les règles sont vérifiées par le serveur : un utilisateur ne peut ni modifier le profil d'un autre, ni s'attribuer un abonnement, ni valider ses propres justificatifs.
- CV et dossiers de compétences : téléchargeables uniquement par les entreprises abonnées ; justificatifs d'entreprise : uniquement par l'entreprise et l'administrateur.
- E-mail, téléphone et photo d'un candidat : visibles par une entreprise seulement après un match.
- L'administrateur ne lit pas le contenu des conversations privées.
- Suppression complète du compte par l'utilisateur (« Mon compte »), conformément au RGPD.

## Prévu en version 2

- Paiement en ligne par carte (Stripe) et factures automatiques.
- Traduction automatique du site et de la messagerie.
- E-mails de notification (nouveau match, nouveau message, fin de période gratuite J-3).
- Recherche par rayon kilométrique.

## Avant l'ouverture au public

- Faire relire les mentions légales, CGV, CGU et la politique de données personnelles par un juriste.
- Créer un compte test candidat et un compte test entreprise pour vérifier le parcours complet.
