"""Constants for Swinger Companion."""

DOMAIN = "swinger_companion"

CONF_PERSON = "person"
CONF_WEBHOOK_ID = "webhook_id"
CONF_KEY = "key"  # AES-256-GCM key (base64url), shared with the userscripts through the webhook address fragment
CONF_SIGN = "sign"  # secret for signed picture addresses
CONF_PLATFORM = "platform"
CONF_NICK = "nick"
CONF_UID = "uid"

SUBENTRY_ACCOUNT = "account"

PLATFORM_NAMES = {"joyclub": "JOYclub", "poppen": "Poppen"}

STATUS_WANT = "want"
STATUS_DONE = "done"
STATUS_NO = "no"
STATUS_NEVER = "never"

PAYLOAD_FORMAT = "swinger-companion"
MAX_BODY = 32 * 1024 * 1024
MAX_THUMB = 200 * 1024
MAX_PIC = 8 * 1024 * 1024  # one full picture; Home Assistant accepts at most 16 MB per request (twice base64)
NEED_PICS_MAX = 50  # missing pictures asked for per answer

SIGNAL_UPDATE = f"{DOMAIN}_update_{{}}"
THUMB_URL = "/api/swinger_companion/thumb/{entry_id}/{pid}"
PIC_URL = "/api/swinger_companion/pic/{entry_id}/{pid}/{key}"
PIC_DIR = "swinger_companion"  # below the configuration directory
