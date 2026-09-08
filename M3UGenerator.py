#!/usr/bin/env python3
"""
Merge multiple remote M3U playlists into a single validated and categorized
master M3U file.

Usage: edit CONFIG_URLS with remote M3U playlist URLs and run the script.

This script downloads each playlist, parses #EXTINF entries, validates stream
URLs using HTTP HEAD (with a browser-like User-Agent and timeout), injects
metadata into the stream URL as query parameters, and writes a grouped
`master_playlist.m3u` organized by language and generic group.

Dependencies: requests, m3u8 (optional but preferred)
Install: pip install requests m3u8
"""

from concurrent.futures import ThreadPoolExecutor, as_completed
from collections import Counter, defaultdict, OrderedDict
from urllib.parse import urlparse, parse_qsl, urlencode, urlunparse
import requests
import re
import sys
import time
import random

try:
    import m3u8  # optional helper
    _HAS_M3U8 = True
except Exception:
    _HAS_M3U8 = False

# optional advanced normalization deps
try:
    from unidecode import unidecode
except Exception:
    unidecode = None

try:
    from rapidfuzz import process as rf_process
    from rapidfuzz import fuzz as rf_fuzz
except Exception:
    rf_process = None
    rf_fuzz = None

# === Configuration ===
CONFIG_URLS = [
    # Put remote M3U playlist URLs here. Example:
    "http://tata.somee.com/",
    "http://dish.somee.com/",
    "http://airtel.somee.com/",
    "https://iptv-org.github.io/iptv/index.m3u",
    "https://bugsfreeweb.github.io/LiveTVCollector/LiveTV/India/LiveTV.m3u",
    "https://raw.githubusercontent.com/FunctionError/PiratesTv/main/combined_playlist.m3u",
    "https://raw.githubusercontent.com/BuddyChewChew/app-m3u-generator/refs/heads/main/playlists/plutotv_all.m3u",
    "https://raw.githubusercontent.com/BuddyChewChew/app-m3u-generator/refs/heads/main/playlists/samsungtvplus_all.m3u",
    "https://apsattv.com/ssungusa.m3u",
    "https://raw.githubusercontent.com/BuddyChewChew/app-m3u-generator/refs/heads/main/playlists/roku_all.m3u",
    "https://www.apsattv.com/uslg.m3u",
    "https://raw.githubusercontent.com/BuddyChewChew/app-m3u-generator/refs/heads/main/playlists/tubi_all.m3u",
    "https://raw.githubusercontent.com/BuddyChewChew/app-m3u-generator/refs/heads/main/playlists/plex_all.m3u",
    "https://www.apsattv.com/vizio.m3u",
    "https://www.apsattv.com/distro.m3u",
    "https://www.apsattv.com/inlg.m3u",
    "https://www.apsattv.com/xiaomi.m3u"
]

SKIP_ITEM_VALIDATION_PLAYLISTS = {
    "http://tata.somee.com/",
    "http://dish.somee.com/",
    "http://airtel.somee.com/",
}

SOURCE_SUFFIX_PLAYLISTS = set(SKIP_ITEM_VALIDATION_PLAYLISTS)

OUTPUT_FILE = "master_playlist.m3u"

# Post-processing reduction (applied when writing playlists)
REDUCE_GLOBAL_URL_DEDUP = True
REDUCE_INTL_HEAVY_DUPES = True
INTL_DUPE_THRESHOLD = 5

INDIAN_PROVIDERS = {"Tata", "Dish", "Airtel"}
_RESOLUTION_SUFFIX = re.compile(r"^\d+p$", re.I)
_REGION_SUFFIXES = {
    "EU", "IT", "IN", "UK", "GB", "DE", "ES", "FR", "Asia", "US", "BR", "PL", "DACH", "DK", "SE",
}

# Temporary filter flag: when True only allow entries that contain Gujarati
# characters in the channel title, group-title or URL.
FILTER_ONLY_GUJARATI = False

# URL overrides: if a channel title contains the key (case-insensitive), replace its stream URL.
URL_OVERRIDES = {
    'b4u music': 'https://cdn-2.pishow.tv/live/415/master.m3u8',
    'star plus': 'http://103.229.254.25:7001/play/a09z/index.m3u8'
}

# Manual channels to add after processing all playlists
# Format: List of dicts with keys: name (required), url (required), group (optional), language (optional), tvg_id (optional), tvg_logo (optional)
# Example:
# MANUAL_CHANNELS = [
#     {
#         'name': 'My Custom Channel',
#         'url': 'https://example.com/stream.m3u8',
#         'group': 'Custom',
#         'language': 'English',
#         'tvg_id': 'custom.channel',
#         'tvg_logo': 'https://example.com/logo.png'
#     }
# ]
MANUAL_CHANNELS = [
      {
         'name': 'Star Plus HD',
         'url': 'http://103.229.254.25:7001/play/a09z/index.m3u8',
         'group': 'Hindi Entertainment',
         'language': 'Hindi',
         'tvg_id': 'StarPlusHin.in@HD',
         'tvg_logo': 'https://raw.githubusercontent.com/subirkumarpaul/Logo/main/Star%20Plus.png'
     },
     {
         'name': 'Classic Hits',
         'url': 'https://mumt03.tangotv.in/CLASSICHITS/index.m3u8',
         'group': 'Hindi Music',
         'language': 'Hindi',
         'tvg_id': 'ClassicHits.in@HD'
     }

]

# Channels matching these patterns will also be added to the specified extra group.
# This applies to channels fetched from remote M3U URLs as well as manual channels.
SPECIAL_CHANNEL_GROUPS = {
    
}

# Validation settings
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    )
}
VALIDATION_TIMEOUT = 15  # Reduced from 30 to fail faster on bad URLs
CONNECTION_TIMEOUT = 10   # Separate connection timeout
MAX_WORKERS = 8
MAX_429_RETRIES = 4
MAX_RETRY_AFTER_WAIT = 20
REQUEST_SPREAD_DELAY_RANGE = (0.03, 0.18)

# Content types considered valid video streams
_VALID_CT_PREFIXES = ("video/", "audio/")
_VALID_CT_EXACT = {
    "application/x-mpegurl",
    "application/vnd.apple.mpegurl",
    "application/vnd.apple.mpegurl; charset=utf-8",
    "application/dash+xml",
    "application/octet-stream",
    "binary/octet-stream",
    "text/plain",
}

# Stream-like URL extensions that may still be valid even with weak/missing content-type
_STREAM_EXTENSIONS = ('.m3u8', '.m3u', '.ts', '.mpd')

# Regexes for parsing plain M3U EXTINF entries
_EXTINF_RE = re.compile(r'^#EXTINF:(?P<duration>[-0-9]+)(?P<attrs>[^,]*),(?P<title>.*)$', re.IGNORECASE)
_ATTR_RE = re.compile(r'([A-Za-z0-9\-]+)\s*=\s*(?:"([^"]*)"|\'([^\']*)\')')


# Enhanced category pattern matching for auto-categorization
CATEGORY_PATTERNS = {
    'Sports': [
        r'\bsports?\b', r'\bstar\s*sports\b', r'\bsony\s*(six|ten|liv)\b',
        r'\bwillow\b', r'\bt\s*sports\b', r'\bcricket\b', r'\bipl\b',
        r'\bfootball\b', r'\beuro\s*sport\b', r'\bten\s*(1|2|3|4|golf|cricket)\b',
        r'\bsky\s*sports\b', r'\bespn\b', r'\bfox\s*sports\b',
        r'\bpremier\s*league\b', r'\bbein\s*sports\b', r'\bptv\s*sports\b',
        r'\bmatch\b', r'\blive\s*sports\b', r'\bsport\s*(klub|plus)\b'
    ],
    'News': [
        r'\bnews\b', r'\bsandesh\b', r'\babp\s*(news|asmita|ananda|majha)?\b',
        r'\baaj\s*tak\b', r'\bndtv\b', r'\btimes\s*now\b', r'\bindia\s*today\b',
        r'\bzee\s*(news|business|punjab|rajasthan|madhya\s*pradesh)?\b',
        r'\brepublic\b', r'\bcnn\b', r'\bbbc\s*(news|world)?\b',
        r'\bal\s*jazeera\b', r'\bsky\s*news\b', r'\bfox\s*news\b',
        r'\bnews\s*(18|24|nation|x|state|world)\b', r'\bdd\s*news\b',
        r'\btv9\b', r'\bsakshi\b', r'\bv6\b', r'\bmirror\s*now\b',
        r'\bpolimer\s*news\b', r'\bputhiya\s*thalaimurai\b', r'\bcnbc\b'
    ],
    'Movies': [
        r'\bmovies?\b', r'\bcinema\b', r'\bfilms?\b', r'\bpictures?\b',
        r'\b&pictures\b', r'\bflix\b', r'\bhbo\b', r'\bstar\s*gold\b',
        r'\bzee\s*(cinema|classic|action|anmol|bollywood)\b',
        r'\bsony\s*max\b', r'\bstar\s*(utsav|bharat)\b',
        r'\b&flix\b', r'\b&prive\b', r'\bmnx\b', r'\bmn\+\b',
        r'\brishtey\b', r'\butv\s*(movies|action|hd)\b',
        r'\bwb\b', r'\buniversal\b', r'\bparamount\b'
    ],
    'Entertainment': [
        r'\bstar\s*plus\b', r'\bsony\s*(tv|pal|hd)\b', r'\bzee\s*tv\b',
        r'\bcolors?\s*(tv|cineplex|gujarati|marathi|tamil)?\b',
        r'\b&tv\b', r'\bsab\b', r'\blife\s*ok\b', r'\bstar\s*bharat\b',
        r'\bdrama\b', r'\bcomedy\b', r'\bserial\b', r'\bshow\b',
        r'\bgemini\b', r'\budaya\b', r'\bsurya\b', r'\bvijay\b',
        r'\betv\b', r'\bmazhavil\b', r'\basianet\b', r'\bflowers\b',
        r'\benter10\b', r'\bdangal\b', r'\bshemaroo\b'
    ],
    'Music': [
        r'\bmusic\b', r'\bmtv\b', r'\b9xm\b', r'\b9x\s*(jalwa|tashan|jhakaas)\b',
        r'\bsangeet\b', r'\bb4u\s*music\b', r'\bmusic\s*india\b',
        r'\bzoom\b', r'\bbindi\b', r'\bmaster\s*tv\b',
        r'\bdhoom\b', r'\bvh1\b', r'\be24\b', r'\bgujarati\s*hits\b'
    ],
    'Kids': [
        r'\bkids?\b', r'\bnick\b', r'\bcartoon\s*network\b', r'\bpogo\b',
        r'\bdisney\b', r'\bhungama\b', r'\bdiscovery\s*kids\b',
        r'\bsonic\b', r'\bten\s*(2|3)\b.*cartoon', r'\banimation\b',
        r'\bchutti\b', r'\bkochu\b', r'\bkushi\b'
    ],
    'Religious': [
        r'\baastha\b', r'\bsankara?\b', r'\bsatsang\b', r'\bdevotional\b',
        r'\btemple\b', r'\bgod\b', r'\bishwar\b', r'\bvedic\b',
        r'\bshubh\b', r'\btotal\s*bhakti\b', r'\bsubhavaartha\b'
    ],
    'Infotainment': [
        r'\bdiscovery\b', r'\bnat\s*geo\b', r'\bnational\s*geographic\b',
        r'\bhistory\b', r'\btravel\s*xp\b', r'\bfood\s*food\b',
        r'\banimal\s*planet\b', r'\bscience\b', r'\btlc\b',
        r'\bdmax\b', r'\bepic\b', r'\binvestigation\b'
    ],
    'Business': [
        r'\bbusiness\b', r'\bcnbc\b', r'\bbloomberg\b', r'\bet\s*now\b',
        r'\bzee\s*business\b', r'\bstock\b', r'\bfinance\b'
    ],
    'Lifestyle': [
        r'\blifestyle\b', r'\bfashion\b', r'\bfoodie\b', r'\btravel\b',
        r'\bhome\s*(tv|shopping)\b', r'\bliving\b', r'\bwion\b'
    ]
}

# Canonical mapping for common variants -> canonical genre
CANONICAL_MAP = {
    'news internasional': 'News',
    'english news': 'News',
    'news': 'News',
    'sports': 'Sports',
    'cricket': 'Sports',
    'football': 'Sports',
    'kids': 'Kids',
    'kidz': 'Kids',
    'children': 'Kids',
    'movies': 'Movies',
    'films': 'Movies',
    'music': 'Music',
    'religious': 'Religious',
    'devotional': 'Religious',
    'entertainment': 'Entertainment',
    'general': 'General',
    'documentary': 'Infotainment',
    'education': 'Infotainment',
    'lifestyle': 'Lifestyle',
    'business': 'Business',
    'comedy': 'Entertainment',
    'classic': 'Classic',
    'series': 'Series',
    'unknown': 'Unknown',
    'ungrouped': 'Ungrouped',

}

LANGUAGE_MAP = {

    # Gujarati
    'gujarati': 'Gujarati',
    'gujrati': 'Gujarati',
    'gujarathi': 'Gujarati',
    'gujju': 'Gujarati',
    'gs tv': 'Gujarati',
    'Sandesh News': 'Gujarati',
    'ABP Asmita': 'Gujarati',

    # Hindi
    'hindi': 'Hindi',
    'hindustani': 'Hindi',

    # English
    'english': 'English',
    'eng': 'English',

    # Bengali
    'bengali': 'Bengali',
    'bangla': 'Bengali',
    'banglaa': 'Bengali',

    # Bangladeshi (kept separate as per original requirement)
    'bangladeshi': 'Bangladeshi',

    # Marathi
    'marathi': 'Marathi',

    # Telugu
    'telugu': 'Telugu',

    # Tamil
    'tamil': 'Tamil',
    'tamizh': 'Tamil',

    # Kannada
    'kannada': 'Kannada',

    # Malayalam
    'malayalam': 'Malayalam',
    'malayali': 'Malayalam',

    # Punjabi
    'punjabi': 'Punjabi',
    'panjabi': 'Punjabi',

    # Urdu
    'urdu': 'Urdu',

    # Odia
    'odia': 'Odia',
    'oriya': 'Odia',

    # Assamese
    'assamese': 'Assamese',

    # Nepali
    'nepali': 'Nepali',
    'nepalese': 'Nepali',

    # Bhojpuri
    'bhojpuri': 'Bhojpuri',

    # Haryanvi
    'haryanvi': 'Haryanvi',

    # Religious (optional category)
    'devotional': 'Religious',
    'bhakti': 'Religious',
    'bhajan': 'Religious',
}

def normalize_label(label: str) -> str:
    """Normalize a category label using unidecode (if available) and cleanup.

    Returns a lowercase, stripped string suitable for matching.
    """
    if not label:
        return ''
    s = label
    # transliterate if possible
    if unidecode:
        try:
            s = unidecode(s)
        except Exception:
            pass
    # lower
    s = s.lower()
    # replace separators with semicolon
    s = re.sub(r'[>\|/\\]+', ';', s)
    s = re.sub(r'\s-\s', ';', s)
    # remove emojis and non-printable / unusual punctuation
    s = re.sub(r'[^\n\w\s;]', ' ', s)
    # collapse whitespace and semicolons
    s = re.sub(r'\s+', ' ', s).strip()
    s = re.sub(r'\s*;\s*', ';', s)
    return s


def split_group_hierarchy(group_title: str):
    """Split raw group-title into parts preserving hierarchy.

    Returns list of parts (strings) in order.
    """
    if not group_title:
        return []
    # common separators: > ; | / - , :
    parts = re.split(r'[>;|/\\,]|\s-\s|:', group_title)
    parts = [p.strip() for p in parts if p and p.strip()]
    return parts


def clean_language(lang: str) -> str:
    """Normalize language string: transliterate and Title-case, remove emojis/punctuation."""
    if not lang:
        return 'Unknown'
    s = lang
    if unidecode:
        try:
            s = unidecode(s)
        except Exception:
            pass
    s = s.strip()
    # remove non-alphanumeric (keep spaces)
    s = re.sub(r'[^A-Za-z0-9\s]', ' ', s)
    s = re.sub(r'\s+', ' ', s).strip()
    return s.title() if s else 'Unknown'


def auto_categorize_channel(channel_name: str, group_title: str = '') -> str:
    """Auto-categorize channel using pattern matching.

    Returns category name like 'Sports', 'News', etc. or 'General' if no match.
    """
    if not channel_name:
        return 'General'

    # Combine channel name and group for better matching
    search_text = f"{channel_name} {group_title}".lower()

    # Try each category pattern
    for category, patterns in CATEGORY_PATTERNS.items():
        for pattern in patterns:
            try:
                if re.search(pattern, search_text, re.IGNORECASE):
                    return category
            except Exception:
                continue

    return 'General'


def canonicalize_group(raw_label: str, existing: list, fuzz_threshold: int = 85) -> str:
    """Return a canonical group name for raw_label.

    Uses CANONICAL_MAP first, then fuzzy matches against existing canonical names
    using rapidfuzz (if available). Falls back to Title-case normalized label.
    """
    norm = normalize_label(raw_label)
    if not norm:
        return 'Unknown'
    # exact mapping
    if norm in CANONICAL_MAP:
        return CANONICAL_MAP[norm]

    # try fuzzy match against mapping keys
    if rf_process and CANONICAL_MAP:
        try:
            match = rf_process.extractOne(norm, list(CANONICAL_MAP.keys()), scorer=rf_fuzz.ratio)
        except Exception:
            match = None
        if match and match[1] >= fuzz_threshold:
            return CANONICAL_MAP.get(match[0], match[0].title())

    # try fuzzy match against existing canonical group names
    if rf_process and existing:
        try:
            match = rf_process.extractOne(norm, existing, scorer=rf_fuzz.ratio)
        except Exception:
            match = None
        if match and match[1] >= fuzz_threshold:
            return match[0]

    # default: title-case each token of normalized label
    # if there are multiple tokens separated by semicolon, take first as generic
    first = norm.split(';')[0]
    # remove any leftover non-alphanumeric characters
    first = re.sub(r'[^a-z0-9\s-]', ' ', first).strip()
    return first.title() if first else 'Unknown'


def contains_gujarati_token(s: str) -> bool:
    """Return True if string contains the text 'Gujarati' (case-insensitive)."""
    if not s:
        return False
    try:
        return 'gujarati' in s.lower()
    except Exception:
        return False


def normalize_channel_name(name: str) -> str:
    if not name:
        return name
    if name.startswith("T Sports HD"):
        return name.replace("T Sports HD", "Starts Sports 1 HD", 1)
    return name


def _get_playlist_source_label(u: str) -> str:
    try:
        host = (urlparse((u or '').strip()).hostname or '').strip().lower()
        if not host:
            return ''
        subdomain = host.split('.')[0].strip()
        return subdomain.title() if subdomain else ''
    except Exception:
        return ''


def _append_source_suffix(title: str, playlist_url: str) -> str:
    label = _get_playlist_source_label(playlist_url)
    if not title or not label:
        return title
    suffix = f"({label})"
    if title.rstrip().endswith(suffix):
        return title
    return f"{title} {suffix}"


def get_extra_groups(entry) -> list:
    """Return extra configured groups for a channel based on title/metadata matching."""
    attrs = entry.get('attrs', {})
    haystack = ' '.join([
        normalize_label(entry.get('title') or ''),
        normalize_label(attrs.get('tvg-id') or ''),
        normalize_label(attrs.get('group-title') or attrs.get('group') or ''),
        normalize_label(entry.get('url') or ''),
    ])

    matched_groups = []
    for group_name, patterns in SPECIAL_CHANNEL_GROUPS.items():
        for pattern in patterns:
            if pattern and re.search(r'\b' + re.escape(normalize_label(pattern)) + r'\b', haystack):
                matched_groups.append(group_name)
                break
    return matched_groups


def fetch_text(url):
    try:
        resp = requests.get(url, headers=HEADERS, timeout=VALIDATION_TIMEOUT)
        resp.raise_for_status()
        return resp.text
    except Exception as e:
        print(f"[WARN] Failed to download playlist {url}: {e}")
        return None


def parse_m3u(content):
    """Parse M3U content and return list of entries.

    Each entry is a dict with keys: title, url, attrs (dict)
    attrs may include tvg-id, tvg-logo, group-title, tvg-language, resolution
    """
    entries = []

    # First try m3u8 if available (works better for HLS), but still fallback to regex
    if _HAS_M3U8:
        try:
            playlist = m3u8.loads(content)
            # m3u8 library focuses on HLS; it provides playlist.media if available.
            # For plain EXTINF lists, fall back to manual parsing below.
        except Exception:
            playlist = None
    else:
        playlist = None

    # Manual parse: iterate lines and pair EXTINF with next line URL
    lines = [ln.strip() for ln in content.splitlines() if ln.strip() != ""]
    i = 0
    while i < len(lines):
        ln = lines[i]
        if ln.upper().startswith("#EXTINF"):
            m = _EXTINF_RE.match(ln)
            if m:
                attrs_raw = m.group('attrs') or ''
                title = m.group('title').strip()
                title = normalize_channel_name(title)
                attrs = {}
                # _ATTR_RE returns tuples (key, val_double, val_single)
                for m in _ATTR_RE.findall(attrs_raw):
                    if not m:
                        continue
                    # m can be a tuple like (key, val1, val2)
                    key = m[0]
                    val = ''
                    if len(m) >= 2 and m[1]:
                        val = m[1]
                    elif len(m) >= 3 and m[2]:
                        val = m[2]
                    if key:
                        attrs[key.lower()] = val
                # fallback: key=value without quotes
                if not attrs and attrs_raw:
                    for k, v in re.findall(r'([A-Za-z0-9\-]+)=([^\s,]+)', attrs_raw):
                        attrs[k.lower()] = v.strip('"\'')
                # resolution heuristics
                if 'resolution' not in attrs:
                    # sometimes resolution is provided as part of title like "(1080p)"
                    res_m = re.search(r'(?P<res>\d{3,4}p)', title)
                    if res_m:
                        attrs['resolution'] = res_m.group('res')

                # next non-comment line is the URL
                url = None
                j = i + 1
                while j < len(lines):
                    if not lines[j].startswith('#'):
                        url = lines[j]
                        break
                    j += 1

                entries.append({'title': title, 'url': url, 'attrs': attrs})
                i = j
            else:
                i += 1
        else:
            i += 1

    return entries


def is_video_content(content_type):
    if not content_type:
        return False
    ctype = content_type.split(';', 1)[0].strip().lower()
    if any(ctype.startswith(p) for p in _VALID_CT_PREFIXES):
        return True
    if ctype in _VALID_CT_EXACT:
        return True
    return False


def _looks_like_stream_by_url(url: str) -> bool:
    try:
        p = urlparse(url)
        path = (p.path or '').lower()
        return path.endswith(_STREAM_EXTENSIONS)
    except Exception:
        return False


def _looks_like_playlist_text(sample_bytes: bytes) -> bool:
    if not sample_bytes:
        return False
    try:
        sample = sample_bytes.decode('utf-8', errors='ignore').strip().lower()
    except Exception:
        return False
    return (
        '#extm3u' in sample
        or '#ext-x-' in sample
        or 'mpd' in sample[:200]
    )


def _parse_retry_after(value):
    if not value:
        return None
    try:
        return max(0.0, float(value))
    except Exception:
        return None


def _request_with_retry(method, url, headers=None, **kwargs):
    req_headers = dict(HEADERS)
    if headers:
        req_headers.update(headers)

    # Use tuple for timeout: (connect_timeout, read_timeout)
    if 'timeout' in kwargs:
        timeout = kwargs['timeout']
        kwargs['timeout'] = (CONNECTION_TIMEOUT, timeout)

    last_resp = None
    for attempt in range(MAX_429_RETRIES + 1):
        try:
            delay = random.uniform(*REQUEST_SPREAD_DELAY_RANGE)
            if delay > 0:
                time.sleep(delay)

            resp = requests.request(method, url, headers=req_headers, **kwargs)
            last_resp = resp

            if resp.status_code != 429:
                return resp

            retry_after = _parse_retry_after(resp.headers.get('Retry-After'))
            backoff = min(MAX_RETRY_AFTER_WAIT, (2 ** attempt))
            wait_s = retry_after if retry_after is not None else backoff
            print(f"[RATE_LIMIT] {method} {url} -> 429, retrying in {wait_s:.1f}s ({attempt + 1}/{MAX_429_RETRIES + 1})")
            resp.close()
            time.sleep(wait_s)
        except (requests.exceptions.Timeout, requests.exceptions.ConnectionError) as e:
            # Fast fail on connection/timeout errors - don't retry
            print(f"[TIMEOUT] {method} {url} -> {type(e).__name__}")
            return None
        except Exception:
            if attempt >= MAX_429_RETRIES:
                raise
            time.sleep(min(MAX_RETRY_AFTER_WAIT, (2 ** attempt)))

    return last_resp


def _normalize_stream_url(u: str) -> str:
    try:
        p = urlparse((u or '').strip())
        scheme = (p.scheme or '').lower()
        netloc = (p.netloc or '').lower()
        path = (p.path or '').rstrip('/').lower()

        query_pairs = parse_qsl(p.query or '', keep_blank_values=True)
        query_pairs.sort(key=lambda kv: (kv[0], kv[1]))
        normalized_query = urlencode(query_pairs, doseq=True)

        return urlunparse((scheme, netloc, path, '', normalized_query, ''))
    except Exception:
        return (u or '').strip().lower().rstrip('/')


def _channel_base_name(name: str) -> str:
    cleaned = re.sub(r"\s*\[(?:Geo-blocked|Not 24/7)\]\s*", "", name or "", flags=re.I)
    while True:
        match = re.match(r"^(.*)\s+\(([^)]+)\)\s*$", cleaned)
        if not match:
            break
        suffix = match.group(2)
        if suffix in INDIAN_PROVIDERS or _RESOLUTION_SUFFIX.match(suffix) or suffix in _REGION_SUFFIXES:
            cleaned = match.group(1).strip()
            continue
        break
    return cleaned.strip()


def _is_indian_provider_channel(title: str) -> bool:
    return any(f"({provider})" in (title or "") for provider in INDIAN_PROVIDERS)


def _stream_quality_score(title: str, url: str, extinf_attrs: dict = None) -> int:
    score = 0
    url_lower = (url or "").lower()
    if ".m3u8" in url_lower:
        score += 50
    if url_lower.startswith("https://"):
        score += 20
    if "live.php" in url_lower or "play/live" in url_lower:
        score -= 30
    if "(Tata)" in (title or ""):
        score += 5
    elif "(Airtel)" in (title or ""):
        score += 3
    elif "(Dish)" in (title or ""):
        score += 1

    resolution = re.search(r"\((\d+p)\)", title or "", re.I)
    if resolution:
        score += {
            "2160p": 100,
            "1080p": 90,
            "720p": 70,
            "576p": 50,
            "480p": 40,
        }.get(resolution.group(1).lower(), 30)
    elif " HD" in (title or ""):
        score += 80

    attrs = extinf_attrs or {}
    if attrs.get("tvg-logo"):
        score += 5
    return score


def _pick_best_write_record(records: list) -> dict:
    return max(
        records,
        key=lambda r: (
            _stream_quality_score(r["title"], r["url"], r.get("attrs")),
            -r["order"],
        ),
    )


def _build_group_title(lang: str, generic: str, entry: dict) -> str:
    group_parts = []
    lang_label = entry.get('lang') or lang
    generic_normalized = (generic or '').strip().lower()
    lang_normalized = (lang_label or '').strip().lower()

    if lang_label and lang_label != 'Unknown' and generic_normalized != lang_normalized:
        group_parts.append(lang_label)
    if generic:
        group_parts.append(generic)

    sub_group = entry.get('sub_group') or ''
    if sub_group:
        group_parts.append(sub_group)

    group_title = ' - '.join(group_parts) if group_parts else generic
    return re.sub(r'[^A-Za-z0-9\s\-]', ' ', str(group_title)).strip()


def _collect_write_records(tree) -> list:
    records = []
    order = 0
    for lang, groups in tree.items():
        for generic, items in groups.items():
            group_seen = set()
            for entry in items:
                validated_url = entry.get('validated_url')
                if not validated_url or validated_url in group_seen:
                    continue
                group_seen.add(validated_url)

                attrs = entry.get('attrs', {})
                records.append({
                    'order': order,
                    'lang': lang,
                    'generic': generic,
                    'entry': entry,
                    'title': entry.get('title') or '',
                    'url': validated_url,
                    'attrs': attrs,
                    'group_title': _build_group_title(lang, generic, entry),
                })
                order += 1
    return records


def _choose_kept_write_orders(records: list) -> tuple[set[int], dict[str, int]]:
    stats = {
        'initial': len(records),
        'after_url': len(records),
        'final': len(records),
    }
    if not records:
        return set(), stats

    working = records
    if REDUCE_GLOBAL_URL_DEDUP:
        url_groups = defaultdict(list)
        for record in records:
            key = _normalize_stream_url(record['url']) or f"__empty__:{record['order']}"
            url_groups[key].append(record)
        working = [_pick_best_write_record(group) for group in url_groups.values()]
        stats['after_url'] = len(working)

    if REDUCE_INTL_HEAVY_DUPES:
        international = [r for r in working if not _is_indian_provider_channel(r['title'])]
        indian = [r for r in working if _is_indian_provider_channel(r['title'])]

        frequencies = Counter(_channel_base_name(r['title']).lower() for r in international)
        heavy_names = {
            name for name, count in frequencies.items() if count >= INTL_DUPE_THRESHOLD
        }

        kept = []
        heavy_groups = defaultdict(list)
        for record in international:
            base = _channel_base_name(record['title']).lower()
            if base in heavy_names:
                heavy_groups[base].append(record)
            else:
                kept.append(record)

        for group in heavy_groups.values():
            kept.append(_pick_best_write_record(group))
        working = kept + indian

    stats['final'] = len(working)
    return {record['order'] for record in working}, stats


def _is_mp4_stream(url: str, content_type: str = None) -> bool:
    try:
        p = urlparse(url or '')
        path = (p.path or '').lower()
        if path.endswith('.mp4'):
            return True
    except Exception:
        pass

    ct = (content_type or '').split(';', 1)[0].strip().lower()
    return ct == 'video/mp4'


def validate_stream(url):
    """Perform HTTP HEAD (fallback to GET) and return tuple(valid, content_type, final_url).

    valid: bool, content_type: str or None, final_url: str
    """
    try:
        final_url = url

        # HEAD can be blocked or return incomplete headers on many IPTV hosts
        resp = _request_with_retry('HEAD', url, timeout=VALIDATION_TIMEOUT, allow_redirects=True)

        # Fast fail if no response (timeout/connection error)
        if resp is None:
            return False, 'Timeout/Connection Error', final_url

        status = resp.status_code
        ctype = resp.headers.get('Content-Type')
        final_url = resp.url or final_url

        if status in (200, 206) and _is_mp4_stream(final_url, ctype):
            resp.close()
            return False, ctype or 'video/mp4', final_url
        if status in (200, 206) and is_video_content(ctype):
            resp.close()
            return True, ctype, final_url

        resp.close()

        # Fallback GET with stream for servers that do not support HEAD correctly
        get_headers = {
            'Accept': '*/*',
            'Range': 'bytes=0-4095',
        }
        resp = _request_with_retry('GET', url, headers=get_headers, timeout=VALIDATION_TIMEOUT, stream=True, allow_redirects=True)

        # Fast fail if no response
        if resp is None:
            return False, 'Timeout/Connection Error', final_url

        status = resp.status_code
        ctype = resp.headers.get('Content-Type')
        final_url = resp.url or final_url

        if status in (200, 206) and _is_mp4_stream(final_url, ctype):
            resp.close()
            return False, ctype or 'video/mp4', final_url

        # Strong pass: expected status + recognized content type
        if status in (200, 206) and is_video_content(ctype):
            resp.close()
            return True, ctype, final_url

        # Soft pass: some servers return weak/incorrect content-type for valid streams
        if status in (200, 206) and _looks_like_stream_by_url(final_url):
            sample = b''
            try:
                sample = next(resp.iter_content(chunk_size=1024), b'')
            except Exception:
                sample = b''

            # Accept known streaming extensions with either playlist-like text
            # or opaque binary response (common for TS segments / protected endpoints)
            if _looks_like_playlist_text(sample) or (sample and b'<' not in sample[:20]):
                resp.close()
                return True, ctype or 'application/octet-stream', final_url

        if status == 429:
            resp.close()
            return False, 'HTTP 429 Too Many Requests', final_url

        resp.close()
        return False, ctype, final_url
    except Exception as e:
        return False, f'Error: {type(e).__name__}', url


def inject_query_params(original_url, params):
    parts = urlparse(original_url)
    qs = dict(parse_qsl(parts.query, keep_blank_values=True))
    # Merge/overwrite
    qs.update({k: v for k, v in params.items() if v is not None})
    new_qs = urlencode(qs, doseq=True)
    new_parts = parts._replace(query=new_qs)
    return urlunparse(new_parts)


def add_manual_channels(validated_entries):
    """Add manually configured channels to the validated entries list."""
    if not MANUAL_CHANNELS:
        return validated_entries
    
    added = 0
    for channel in MANUAL_CHANNELS:
        if not channel.get('name') or not channel.get('url'):
            print(f"[WARN] Skipping manual channel with missing name or url: {channel}")
            continue
        
        entry = {
            'title': normalize_channel_name(channel.get('name')),
            'url': channel.get('url'),
            'attrs': {
                'group-title': channel.get('group', 'Custom'),
                'tvg-language': channel.get('language', 'Unknown'),
                'tvg-id': channel.get('tvg_id', ''),
                'tvg-logo': channel.get('tvg_logo', ''),
            },
            'source_playlist': 'manual',
            'content_type': 'application/x-mpegurl'  # assume HLS by default
        }
        validated_entries.append(entry)
        added += 1
        print(f"[MANUAL] Added channel: {channel.get('name')} -> {channel.get('url')}")
    
    if added > 0:
        print(f"[INFO] Total manual channels added: {added}")
    return validated_entries


def _normalize_url_for_match(u: str) -> str:
    return _normalize_stream_url(u)


def process_playlists(urls):
    # Collect all parsed entries
    parsed_entries = []
    source_suffix_playlists = {_normalize_url_for_match(u) for u in SOURCE_SUFFIX_PLAYLISTS}
    for purl in urls:
        print(f"[INFO] Downloading playlist: {purl}")
        text = fetch_text(purl)
        if not text:
            continue
        entries = parse_m3u(text)
        normalized_source = _normalize_url_for_match(purl)
        for e in entries:
            e['source_playlist'] = purl
            if normalized_source in source_suffix_playlists:
                e['title'] = _append_source_suffix(e.get('title'), purl)
            parsed_entries.append(e)

    print(f"[INFO] Total entries parsed: {len(parsed_entries)}")

    # Apply URL overrides based on channel title
    for entry in parsed_entries:
        title_lower = (entry.get('title') or '').lower()
        for pattern, override_url in URL_OVERRIDES.items():
            if pattern.lower() in title_lower:
                entry['url'] = override_url
                break

    skip_validation_sources = {_normalize_url_for_match(u) for u in SKIP_ITEM_VALIDATION_PLAYLISTS}
    entries_to_validate = []
    validated = []

    for e in parsed_entries:
        src = _normalize_url_for_match(e.get('source_playlist') or '')
        if src in skip_validation_sources:
            raw_url = e.get('url') or ''
            if _is_mp4_stream(raw_url):
                print(f"[SKIP-MP4] ({e.get('title')}) excluded mp4 link: {raw_url}")
                continue
            e['final_url'] = raw_url
            validated.append(e)
            print(f"[SKIP] ({e.get('title')}) validation skipped (source: {e.get('source_playlist')})")
        else:
            entries_to_validate.append(e)

    # Validate streams concurrently
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
        future_to_entry = {ex.submit(validate_stream, e['url']): e for e in entries_to_validate if e.get('url')}
        total = len(future_to_entry)
        checked = 0
        for fut in as_completed(future_to_entry):
            e = future_to_entry[fut]
            checked += 1
            try:
                ok, ctype, final_url = fut.result()
            except Exception:
                ok, ctype, final_url = False, None, e.get('url')

            original_url = e.get('url')
            resolved_url = original_url
            e['final_url'] = resolved_url
            e['url'] = resolved_url

            if ok:
                e['content_type'] = ctype
                validated.append(e)
                print(f"[OK] ({e['title']}) ({checked}/{total}) {original_url} -> {resolved_url} [{ctype}]")
            else:
                print(f"[BAD] ({e['title']}) ({checked}/{total}) {resolved_url} -> {ctype}")

    print(f"[INFO] Validated streams: {len(validated)}")

    # Add manually configured channels
    validated = add_manual_channels(validated)

    # Categorize by language then generic group
    tree = OrderedDict()
    seen_urls = set()

    # track original normalized URLs to deduplicate across sources
    # keep query params (sorted) so links like ?stream=111 and ?stream=222
    # are treated as distinct streams.
    def normalize_orig_url(u):
        return _normalize_stream_url(u)

    duplicates_skipped = 0
    gujarati_skipped = 0
    canonical_names = []

    for e in validated:
        attrs = e.get('attrs', {})
        lang = attrs.get('tvg-language') or attrs.get('language') or 'Unknown'
        raw_group = attrs.get('group-title') or attrs.get('group') or 'Ungrouped'

        raw_group_norm = normalize_label(raw_group)
        detected_lang = None
        title_norm = normalize_label(e.get('title') or '')
        tvg_id_norm = normalize_label(attrs.get('tvg-id') or '')
        tvg_lang_norm = normalize_label(attrs.get('tvg-language') or attrs.get('language') or '')
        url_norm = normalize_label(e.get('url') or '')
        combined = ' '.join([raw_group_norm, title_norm, tvg_id_norm, tvg_lang_norm, url_norm])

        for token, canon in LANGUAGE_MAP.items():
            if re.search(r'\b' + re.escape(token) + r'\b', combined):
                detected_lang = canon
                raw_group_norm = re.sub(r'\b' + re.escape(token) + r'\b', '', raw_group_norm)
                break

        if detected_lang and (not lang or lang == 'Unknown'):
            lang = detected_lang

        cleaned_group = re.sub(r'\s*;\s*', ';', raw_group_norm).strip(' ;')
        if not cleaned_group:
            cleaned_group = 'Ungrouped'

        # Auto-categorize using pattern matching
        auto_category = auto_categorize_channel(e.get('title') or '', raw_group)

        parts = split_group_hierarchy(cleaned_group)
        if not parts:
            parts = [cleaned_group]

        # Use auto-detected category if original group is generic/unknown
        if parts[0].lower() in ['ungrouped', 'general', 'unknown', '']:
            generic = auto_category
        else:
            generic = canonicalize_group(parts[0], canonical_names)

        if generic not in canonical_names:
            canonical_names.append(generic)

        sub_parts = parts[1:]
        canonical_subs = []
        for sp in sub_parts:
            csp = canonicalize_group(sp, canonical_names)
            canonical_subs.append(csp)
            if csp not in canonical_names:
                canonical_names.append(csp)

        sub = ' > '.join(canonical_subs) if canonical_subs else ''

        # Store auto-detected category for logging
        e['auto_category'] = auto_category

        orig_norm = normalize_orig_url(e.get('url') or '')

        ctype = e.get('content_type') or ''
        ctype_main = (ctype.split(';', 1)[0].strip() if ctype else '')
        resolution = attrs.get('resolution') or attrs.get('tvg-res') or attrs.get('res')
        params = {
            'video_type': ctype_main or None,
            'resolution': resolution or None,
            'source_group': generic or None,
        }
        new_url = inject_query_params(e['url'], params)
        e['validated_url'] = new_url
        e['lang'] = lang
        e['generic_group'] = generic
        e['sub_group'] = sub

        if FILTER_ONLY_GUJARATI:
            tvg_id = attrs.get('tvg-id') or ''
            tvg_lang = attrs.get('tvg-language') or attrs.get('language') or ''
            if not (contains_gujarati_token(e.get('title') or '')
                    or contains_gujarati_token(raw_group)
                    or contains_gujarati_token(e.get('url') or '')
                    or contains_gujarati_token(tvg_id)
                    or contains_gujarati_token(tvg_lang)):
                gujarati_skipped += 1
                print(f"[FILTER] Skipped non-Gujarati entry: {e.get('title')} | {e.get('url')}")
                continue

        groups_to_add = []
        groups_to_add.append(generic)

        combined_label = cleaned_group
        try:
            combined_label_title = re.sub(r'[^A-Za-z0-9\s\-]', ' ', combined_label).strip().title()
        except Exception:
            combined_label_title = (combined_label or '').title()
        if combined_label_title and combined_label_title not in groups_to_add:
            groups_to_add.append(combined_label_title)

        if detected_lang and detected_lang not in groups_to_add:
            groups_to_add.append(detected_lang)

        try:
            lang_label = clean_language(lang)
        except Exception:
            lang_label = lang
        if lang_label and lang_label != 'Unknown' and lang_label not in groups_to_add:
            groups_to_add.append(lang_label)

        try:
            if detected_lang:
                composite = f"{detected_lang} {generic}"
                if composite not in groups_to_add:
                    groups_to_add.append(composite)
        except Exception:
            pass

        for extra_group in get_extra_groups(e):
            if extra_group not in groups_to_add:
                groups_to_add.append(extra_group)

        section_lang = lang
        tree.setdefault(section_lang, OrderedDict())
        tree.setdefault('Genres', OrderedDict())

        for grp in groups_to_add:
            key_lang = (section_lang, grp, orig_norm)
            if key_lang in seen_urls:
                duplicates_skipped += 1
            else:
                seen_urls.add(key_lang)
                tree[section_lang].setdefault(grp, []).append(e)

        for grp in groups_to_add:
            exists_in_language = any(k for k in seen_urls if k[1] == grp and k[2] == orig_norm and k[0] != 'Genres')
            if exists_in_language:
                continue
            key_genre = ('Genres', grp, orig_norm)
            if key_genre in seen_urls:
                duplicates_skipped += 1
            else:
                seen_urls.add(key_genre)
                tree['Genres'].setdefault(grp, []).append(e)

    def normalize_group_key(k: str) -> str:
        return re.sub(r'[^A-Za-z0-9\s\-]', '', k or '').strip().title()

    consolidated = OrderedDict()
    for lang, groups in tree.items():
        merged = OrderedDict()
        for gname, items in groups.items():
            key = normalize_group_key(gname)
            merged.setdefault(key, []).extend(items)

        for k, items in merged.items():
            seen = set()
            uniq = []
            for it in items:
                orig = normalize_orig_url(it.get('url') or '')
                if orig in seen:
                    continue
                seen.add(orig)
                uniq.append(it)
            merged[k] = uniq

        consolidated[lang] = merged

    consolidated = OrderedDict(consolidated)
    origs_in_languages = set()
    for lang_key, groups in consolidated.items():
        if lang_key == 'Genres':
            continue
        for grp_items in groups.values():
            for it in grp_items:
                origs_in_languages.add(normalize_orig_url(it.get('url') or ''))

    if 'Genres' in consolidated:
        new_genre_groups = OrderedDict()
        for gname, items in consolidated['Genres'].items():
            kept = []
            for it in items:
                if normalize_orig_url(it.get('url') or '') in origs_in_languages:
                    continue
                kept.append(it)
            if kept:
                new_genre_groups[gname] = kept
        if new_genre_groups:
            consolidated['Genres'] = new_genre_groups
        else:
            consolidated.pop('Genres', None)

    print(f"[INFO] Duplicates skipped during processing: {duplicates_skipped}")
    if FILTER_ONLY_GUJARATI:
        print(f"[INFO] Entries skipped by Gujarati filter: {gujarati_skipped}")
    return consolidated


def write_master(tree, out_file=OUTPUT_FILE):
    records = _collect_write_records(tree)
    kept_orders, reduce_stats = _choose_kept_write_orders(records)
    kept_records = [record for record in records if record['order'] in kept_orders]

    with open(out_file, 'w', encoding='utf-8') as fh:
        fh.write('#EXTM3U\n')
        current_lang = None
        current_group = None

        for record in kept_records:
            lang = record['lang']
            generic = record['generic']
            entry = record['entry']
            attrs = entry.get('attrs', {})
            tvg_id = attrs.get('tvg-id', '')
            tvg_logo = attrs.get('tvg-logo', '')
            group_title = record['group_title']
            title = record['title']
            validated_url = record['url']

            if lang != current_lang:
                fh.write(f"\n#LANG:{lang}\n")
                current_lang = lang
                current_group = None

            if generic != current_group:
                fh.write(f"\n#GROUP:{generic}\n")
                current_group = generic

            ext_attrs = []
            if tvg_id:
                ext_attrs.append(f'tvg-id="{tvg_id}"')
            if tvg_logo:
                ext_attrs.append(f'tvg-logo="{tvg_logo}"')
            if group_title:
                ext_attrs.append(f'group-title="{group_title}"')

            ext_attr_str = ' '.join(ext_attrs)
            fh.write(f"#EXTINF:-1 {ext_attr_str},{title}\n")
            fh.write(f"{validated_url}\n")

    print(f"[INFO] Master playlist written to: {out_file}")
    if REDUCE_GLOBAL_URL_DEDUP or REDUCE_INTL_HEAVY_DUPES:
        print(
            f"[REDUCE] {out_file}: {reduce_stats['initial']} -> "
            f"{reduce_stats['after_url']} (URL dedup) -> {reduce_stats['final']} (final)"
        )
    return reduce_stats


def print_category_summary(tree):
    """Print a summary of identified categories with counts of channels."""
    print("\n[SUMMARY] Categories and channel counts:")
    total = 0
    category_stats = {}

    for lang, groups in tree.items():
        lang_count = sum(len(items) for items in groups.values())
        total += lang_count
        print(f"  {lang}: {lang_count} channel(s)")
        for generic, items in groups.items():
            print(f"    {generic}: {len(items)}")

            # Track category stats
            category_stats[generic] = category_stats.get(generic, 0) + len(items)

            subs = {}
            for e in items:
                sub = e.get('sub_group') or ''
                if sub:
                    subs[sub] = subs.get(sub, 0) + 1
            for sub_name, cnt in subs.items():
                print(f"      {sub_name}: {cnt}")

    print(f"  TOTAL CHANNELS: {total}\n")

    # Print auto-categorization stats
    print("[AUTO-CATEGORIZATION] Pattern matching results:")
    sorted_cats = sorted(category_stats.items(), key=lambda x: x[1], reverse=True)
    for cat, count in sorted_cats:
        percentage = (count / total * 100) if total > 0 else 0
        print(f"  {cat}: {count} ({percentage:.1f}%)")
    print()


def main():
    if not CONFIG_URLS:
        print("[ERROR] No playlist URLs configured. Edit CONFIG_URLS in the script.")
        sys.exit(1)

    start = time.time()
    tree = process_playlists(CONFIG_URLS)
    write_master(tree)
    write_master(tree, "mp.m3u")
    print_category_summary(tree)
    dur = time.time() - start
    print(f"[DONE] Completed in {dur:.1f}s")


if __name__ == '__main__':
    main()

