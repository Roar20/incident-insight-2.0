/**
 * Keyword taxonomy that sorts incidents into service categories.
 *
 * This is intentionally a transparent keyword map rather than a model: an ops
 * lead needs to be able to read why a ticket landed in a bucket, and to add a
 * term when their environment uses different wording. Order matters — the first
 * category whose pattern matches wins, so put the specific ones first.
 */
export interface Category {
  name: string;
  pattern: RegExp;
}

export const CATEGORIES: Category[] = [
  { name: 'Account & Access', pattern: /\b(password|passwd|contraseña|account lock|locked out|lockout|unlock|reset.{0,12}password|mfa|multi.?factor|2fa|authenticat|credential|sso|single sign|permission|access request|grant access|no access|denied access|acceso|bloqueo de cuenta)\b/i },
  { name: 'VPN & Remote Access', pattern: /\b(vpn|remote access|anyconnect|globalprotect|forticlient|remote desktop|rdp|citrix|terminal server|escritorio remoto)\b/i },
  { name: 'Email & Collaboration', pattern: /\b(outlook|exchange|mailbox|buzon|buzón|correo|email|e-mail|smtp|distribution list|calendar|teams|sharepoint|onedrive|zoom|slack)\b/i },
  { name: 'Network & Connectivity', pattern: /\b(network|wifi|wi-fi|wireless|ethernet|lan|wan|switch|router|firewall|dns|dhcp|ip address|latency|packet loss|no internet|sin internet|conectividad|connectivity|disconnect)\b/i },
  { name: 'Hardware & Devices', pattern: /\b(laptop|desktop|monitor|keyboard|mouse|docking|dock station|battery|screen|hard drive|ssd|ram|motherboard|headset|webcam|scanner|hardware|dispatch|equipo|teclado|pantalla)\b/i },
  { name: 'Printing', pattern: /\b(print|printer|printing|spooler|toner|cartridge|impresora|imprimir|scan to)\b/i },
  { name: 'Performance & Availability', pattern: /\b(slow|slowness|performance|latency|hang|hanging|freez|frozen|crash|crashing|unresponsive|timeout|timed out|outage|down|unavailable|degraded|lento|caido|caído|no responde)\b/i },
  { name: 'Storage & Capacity', pattern: /\b(disk (space|full)|storage|capacity|quota|out of space|no space|espacio en disco|file share|shared drive|nas|san)\b/i },
  { name: 'Certificates & Expiry', pattern: /\b(certificate|cert expir|ssl|tls|expired|expiry|renewal|licence|license expir|certificado|caducad)\b/i },
  { name: 'Database', pattern: /\b(database|sql|oracle|postgres|mysql|mongo|query|deadlock|replication|base de datos)\b/i },
  { name: 'Backup & Recovery', pattern: /\b(backup|restore|recovery|snapshot|veeam|respaldo|recuperaci)\b/i },
  { name: 'Monitoring Alerts', pattern: /\b(alert triggered|monitoring|threshold|cluster name|namespace|pod name|container name|document count|conditions met|cpu usage|memory usage|elasticsearch|grafana|datadog|splunk)\b/i },
  { name: 'Software & Applications', pattern: /\b(install|installation|upgrade|update|patch|version|licen[cs]e|application|software|erp|sap|salesforce|browser|chrome|edge|firefox|excel|word|instalaci|aplicaci)\b/i },
  { name: 'Security', pattern: /\b(phishing|malware|virus|ransomware|spam|suspicious|breach|vulnerab|antivirus|threat|seguridad)\b/i },
];

export const UNCATEGORIZED = 'Other / Uncategorised';

/** All category names plus the fallback bucket, in display order. */
export const CATEGORY_NAMES: string[] = [...CATEGORIES.map(c => c.name), UNCATEGORIZED];

/**
 * Classify an incident from its short description and body.
 *
 * The short description is weighted first: it is what the reporter chose to
 * summarise the problem, so a match there beats an incidental mention deeper in
 * the description.
 */
export function categorize(shortDescription: string, description = ''): string {
  for (const { name, pattern } of CATEGORIES) {
    if (pattern.test(shortDescription)) return name;
  }
  for (const { name, pattern } of CATEGORIES) {
    if (pattern.test(description)) return name;
  }
  return UNCATEGORIZED;
}
