#!/usr/bin/env python3
"""Réglages d'authentification du projet Supabase (mdlf-training) pour la vague « Comptes 2 » :
connexion par code e-mail (SMTP Resend), Google, liaison manuelle des identités, limites d'envoi,
e-mails de sécurité (moyen de connexion relié ou retiré, adresse changée).

Par défaut, n'envoie RIEN : affiche les réglages qui seraient appliqués (PATCH de la Management API
https://api.supabase.com/v1/projects/{ref}/config/auth), secrets masqués, et ce qui manque encore.
Avec --appliquer seulement, et toutes les valeurs remplies, il les envoie. À relire avant.

Valeurs à fournir (variables d'environnement, jamais dans le dépôt) :
  RESEND_API_KEY          clé d'API Resend (sert de mot de passe SMTP), domaine d'envoi vérifié chez Resend
  MDLF_MAIL_FROM          adresse d'expédition sur ce domaine, ex. noreply@mdlf.app (domaine vérifié chez Resend le 25/10/2026)
  GOOGLE_WEB_CLIENT_ID    client OAuth « Application Web » (Google Cloud) : Supabase s'en sert comme client principal
  GOOGLE_WEB_SECRET       son secret
  GOOGLE_IOS_CLIENT_ID    client OAuth « iOS » (bundle com.mdlf.training) : audience des jetons de l'app,
                          le même que GIDClientID dans ios/App/App/Info.plist
Jeton de la Management API : SUPABASE_ACCESS_TOKEN, sinon ~/.config/mdlf/supabase_token.

Lancer :  python3 scripts/supabase-auth-config.py              (lecture seule : affiche)
          python3 scripts/supabase-auth-config.py --appliquer  (envoie le PATCH)
          --notifications : seulement les e-mails de sécurité (aucun secret à fournir), avec ou sans --appliquer
"""
import json
import os
import sys
import urllib.request

PROJECT_REF = 'yopptmdjtnezmccdvaxf'
API = f'https://api.supabase.com/v1/projects/{PROJECT_REF}/config/auth'
SECRET_KEYS = {'smtp_pass', 'external_google_secret'}

# Message du code, en français. {{ .Token }} : le code à 6 chiffres (pas de lien magique : l'app
# attend un code). Même texte pour un compte nouveau (confirmation) et existant (magic link).
CODE_SUBJECT = 'Ton code MDLF Training : {{ .Token }}'
CODE_HTML = """<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:420px;margin:0 auto;padding:24px;color:#111">
  <h1 style="font-size:20px;margin:0 0 12px">Ton code de connexion</h1>
  <p style="font-size:15px;line-height:1.45;margin:0 0 20px">Saisis ce code dans MDLF Training. Il est valable 10 minutes.</p>
  <p style="font-size:34px;font-weight:700;letter-spacing:8px;margin:0 0 20px">{{ .Token }}</p>
  <p style="font-size:13px;line-height:1.45;color:#666;margin:0">Tu n'as rien demandé ? Ignore ce message : personne ne peut se connecter sans ce code.</p>
</div>"""
CHANGE_SUBJECT = 'Confirme ton adresse e-mail : {{ .Token }}'
CHANGE_HTML = CODE_HTML.replace('Ton code de connexion', 'Confirme ton adresse e-mail').replace(
    'Saisis ce code dans MDLF Training.', 'Pour ajouter cette adresse à ton compte MDLF Training, saisis ce code.')

# E-mails de sécurité (notifications de Supabase Auth, envoyés à l'adresse du compte après coup) : un
# moyen de connexion relié ou retiré, l'adresse changée. Un compte Apple sans adresse n'en reçoit pas.
# Variables de Supabase : {{ .Provider }} (apple, google, email), {{ .Email }}, {{ .OldEmail }}.
# Noms des champs relevés dans GET /v1/projects/{ref}/config/auth le 25/10/2026.
def notice_html(title, text):
    return f"""<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:420px;margin:0 auto;padding:24px;color:#111">
  <h1 style="font-size:20px;margin:0 0 12px">{title}</h1>
  <p style="font-size:15px;line-height:1.45;margin:0 0 16px">{text}</p>
  <p style="font-size:13px;line-height:1.45;color:#666;margin:0">Ce n'est pas toi ? Écris à contact@mdlf.app.</p>
</div>"""


LINKED_SUBJECT = 'Nouveau moyen de connexion sur ton compte MDLF Training'
LINKED_HTML = notice_html('Nouveau moyen de connexion',
                          'Ton compte {{ .Provider }} a été relié à ton compte MDLF Training ({{ .Email }}). Tu peux maintenant te connecter avec.')
UNLINKED_SUBJECT = 'Moyen de connexion retiré de ton compte MDLF Training'
UNLINKED_HTML = notice_html('Moyen de connexion retiré',
                            'Ton compte {{ .Provider }} a été retiré des moyens de connexion de ton compte MDLF Training ({{ .Email }}).')
EMAIL_CHANGED_SUBJECT = 'Adresse e-mail changée sur ton compte MDLF Training'
EMAIL_CHANGED_HTML = notice_html('Adresse e-mail changée',
                                 "L'adresse de ton compte MDLF Training est passée de {{ .OldEmail }} à {{ .Email }}.")


def env(name):
    return os.environ.get(name, '').strip()


def settings():
    google_ids = ','.join(x for x in (env('GOOGLE_WEB_CLIENT_ID'), env('GOOGLE_IOS_CLIENT_ID')) if x)
    return {
        # E-mail : connexion par code, confirmation obligatoire (le code vaut confirmation)
        'external_email_enabled': True,
        'mailer_autoconfirm': False,
        'mailer_otp_exp': 600,               # 10 min (OTP_TTL_MS dans js/data/account-auth.js)
        'mailer_otp_length': 6,              # OTP_LENGTH
        'mailer_secure_email_change_enabled': True,
        'mailer_subjects_confirmation': CODE_SUBJECT,
        'mailer_templates_confirmation_content': CODE_HTML,
        'mailer_subjects_magic_link': CODE_SUBJECT,
        'mailer_templates_magic_link_content': CODE_HTML,
        'mailer_subjects_email_change': CHANGE_SUBJECT,
        'mailer_templates_email_change_content': CHANGE_HTML,
        # SMTP Resend (le SMTP par défaut de Supabase n'écrit qu'aux membres de l'équipe : email_address_not_authorized)
        'smtp_host': 'smtp.resend.com',
        'smtp_port': '465',
        'smtp_user': 'resend',
        'smtp_pass': env('RESEND_API_KEY'),
        'smtp_admin_email': env('MDLF_MAIL_FROM'),
        'smtp_sender_name': 'MDLF Training',
        # Limites : un code par adresse et par minute (OTP_RESEND_MS), 100 e-mails par heure pour le projet
        'smtp_max_frequency': 60,
        'rate_limit_email_sent': 100,
        'rate_limit_otp': 30,                # demandes et vérifications de code par 5 min et par adresse IP
        'rate_limit_verify': 30,
        # Google : jeton d'identité natif (signInWithIdToken), nonce vérifié
        'external_google_enabled': True,
        'external_google_client_id': google_ids,
        'external_google_secret': env('GOOGLE_WEB_SECRET'),
        'external_google_skip_nonce_check': False,
        # Ajout / retrait de moyens de connexion depuis l'écran Compte (linkIdentity, unlinkIdentity)
        'security_manual_linking_enabled': True,
        # E-mails de sécurité : prévenir le titulaire si quelqu'un relie un moyen de connexion à son compte
        # (session volée), en retire un ou change l'adresse
        'mailer_notifications_identity_linked_enabled': True,
        'mailer_subjects_identity_linked_notification': LINKED_SUBJECT,
        'mailer_templates_identity_linked_notification_content': LINKED_HTML,
        'mailer_notifications_identity_unlinked_enabled': True,
        'mailer_subjects_identity_unlinked_notification': UNLINKED_SUBJECT,
        'mailer_templates_identity_unlinked_notification_content': UNLINKED_HTML,
        'mailer_notifications_email_changed_enabled': True,
        'mailer_subjects_email_changed_notification': EMAIL_CHANGED_SUBJECT,
        'mailer_templates_email_changed_notification_content': EMAIL_CHANGED_HTML,
    }


def missing(conf):
    if 'smtp_pass' not in conf:   # --notifications : rien de secret
        return []
    need = {'smtp_pass': 'RESEND_API_KEY', 'smtp_admin_email': 'MDLF_MAIL_FROM', 'external_google_secret': 'GOOGLE_WEB_SECRET'}
    out = [v for k, v in need.items() if not conf[k]]
    if not env('GOOGLE_WEB_CLIENT_ID'):
        out.append('GOOGLE_WEB_CLIENT_ID')
    if not env('GOOGLE_IOS_CLIENT_ID'):
        out.append('GOOGLE_IOS_CLIENT_ID')
    return out


def token():
    t = env('SUPABASE_ACCESS_TOKEN')
    if t:
        return t
    with open(os.path.expanduser('~/.config/mdlf/supabase_token'), encoding='utf-8') as fh:
        return fh.read().strip()


NOTIFICATION_KEYS = ('_notification', 'mailer_notifications_')


def main():
    conf = settings()
    if '--notifications' in sys.argv[1:]:
        conf = {k: v for k, v in conf.items() if any(n in k for n in NOTIFICATION_KEYS)}
    shown = {k: ('••••' if k in SECRET_KEYS and v else v) for k, v in conf.items()}
    print(json.dumps(shown, ensure_ascii=False, indent=2))
    lack = missing(conf)
    if lack:
        print('\nÀ fournir avant d\'appliquer : ' + ', '.join(lack))
    if '--appliquer' not in sys.argv[1:]:
        print('\nLecture seule : rien n\'a été envoyé (ajouter --appliquer pour envoyer).')
        return 0
    if lack:
        print('Valeurs manquantes : rien n\'est envoyé.')
        return 1
    req = urllib.request.Request(API, method='PATCH', data=json.dumps(conf).encode(),
                                 headers={'Authorization': f'Bearer {token()}', 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=30) as r:
        print(f'Appliqué ({r.status}).')
    return 0


if __name__ == '__main__':
    sys.exit(main())
