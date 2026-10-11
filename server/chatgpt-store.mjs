import {mkdir, lstat, readFile, open, rename, rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import lockfile from 'proper-lockfile';

const empty = () => ({version: 1, hostId: null, profiles: []});
const storageError = () => new Error('Secure local ChatGPT storage is unavailable. Saved credentials were preserved.');

export function windowsPowerShellEnvironment(environment = process.env) {
  // Windows names are case-insensitive, but spawn's plain object can contain both
  // PSMODULEPATH and PSModulePath. Remove every casing before setting the value.
  const entries = Object.entries(environment);
  const systemRoot = entries.find(([key]) => key.toLowerCase() === 'systemroot')?.[1] || 'C:\\Windows';
  return {...Object.fromEntries(entries.filter(([key]) => key.toLowerCase() !== 'psmodulepath')),
    PSModulePath: path.join(systemRoot, 'System32/WindowsPowerShell/v1.0/Modules')};
}

function powershell(script, input) {
  return new Promise((resolve, reject) => {
    const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
    const child = spawn(executable, ['-NoProfile', '-NonInteractive', '-Command',
      "[Console]::InputEncoding=[Text.UTF8Encoding]::new($false);[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$ErrorActionPreference='Stop';" + script],
      {windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: windowsPowerShellEnvironment()});
    const chunks = []; let bytes = 0;
    const timer = setTimeout(() => { child.kill(); reject(storageError()); }, 10000);
    child.stdout.on('data', chunk => { bytes += chunk.length; if (bytes > 2 * 1024 * 1024) child.kill(); else chunks.push(chunk); });
    child.stderr.resume(); // Never expose a secret-bearing OS diagnostic.
    child.on('error', () => { clearTimeout(timer); reject(storageError()); });
    child.on('close', code => { clearTimeout(timer); code === 0 && bytes <= 2 * 1024 * 1024 ? resolve(Buffer.concat(chunks).toString('utf8').trim()) : reject(storageError()); });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

export const windowsProtection = {
  available: () => process.platform === 'win32',
  async protectDirectory(directory, create) {
    const prefix = "$target=[Console]::In.ReadToEnd();$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User;";
    const write = "$acl=[Security.AccessControl.DirectorySecurity]::new();$acl.SetOwner($sid);$acl.SetAccessRuleProtection($true,$false);$rule=[Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow');$acl.AddAccessRule($rule);Set-Acl -LiteralPath $target -AclObject $acl;";
    const check = "$acl=Get-Acl -LiteralPath $target;if($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value -or -not $acl.AreAccessRulesProtected){throw 'Unsafe storage'};foreach($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){if($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -ne $sid.Value){throw 'Unsafe storage'}};";
    await powershell(prefix + (create ? write : '') + check, directory);
  },
  async encrypt(plaintext) {
    return powershell("Add-Type -AssemblyName System.Security;$bytes=[Text.Encoding]::UTF8.GetBytes([Console]::In.ReadToEnd());$cipher=[Security.Cryptography.ProtectedData]::Protect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Out.Write([Convert]::ToBase64String($cipher));", plaintext);
  },
  async decrypt(ciphertext) {
    return powershell("Add-Type -AssemblyName System.Security;$bytes=[Convert]::FromBase64String([Console]::In.ReadToEnd());$plain=[Security.Cryptography.ProtectedData]::Unprotect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Out.Write([Text.Encoding]::UTF8.GetString($plain));", ciphertext);
  },
};

// Dedicated application storage, never a Codex/auth path or a repository file.
export function defaultStorageDirectory() {
  return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData/Local'), 'CampaignCompass', 'ChatGPT');
}

export class ChatGPTStore {
  constructor({directory = defaultStorageDirectory(), protection = windowsProtection} = {}) {
    this.directory = directory; this.protection = protection;
    this.filename = path.join(directory, 'connections.dpapi.json');
  }
  async exists() {
    try { const stat = await lstat(this.directory); if (!stat.isDirectory() || stat.isSymbolicLink()) throw storageError(); return true; }
    catch (error) { if (error.code === 'ENOENT') return false; throw storageError(); }
  }
  async read() {
    if (!await this.exists()) return empty(); // No directory or host ID created on app load.
    if (!this.protection.available()) throw storageError();
    await this.protection.protectDirectory(this.directory, false);
    try {
      const stat = await lstat(this.filename);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024) throw storageError();
      const envelope = JSON.parse(await readFile(this.filename, 'utf8'));
      if (envelope.version !== 1 || envelope.protection !== 'windows-dpapi-current-user' || typeof envelope.ciphertext !== 'string') throw storageError();
      const state = JSON.parse(await this.protection.decrypt(envelope.ciphertext));
      if (state.version !== 1 || !Array.isArray(state.profiles) || state.profiles.length > 20 ||
          (state.hostId !== null && !/^urn:uuid:[0-9a-f-]{36}$/.test(state.hostId))) throw storageError();
      return state;
    } catch (error) { if (error.code === 'ENOENT') return empty(); throw storageError(); }
  }
  async withLock(operation) {
    if (!this.protection.available()) throw storageError();
    const existed = await this.exists();
    if (!existed) await mkdir(this.directory, {recursive: true, mode: 0o700});
    await this.protection.protectDirectory(this.directory, !existed);
    let release;
    try {
      release = await lockfile.lock(this.directory, {realpath: false, stale: 120000, update: 10000,
        retries: {retries: 40, factor: 1, minTimeout: 100, maxTimeout: 100}});
      const state = await this.read();
      const save = async () => {
        const ciphertext = await this.protection.encrypt(JSON.stringify(state));
        const temporary = path.join(this.directory, `.${randomUUID()}.tmp`);
        try {
          const file = await open(temporary, 'wx', 0o600);
          try { await file.writeFile(JSON.stringify({version: 1, protection: 'windows-dpapi-current-user', ciphertext})); await file.sync(); }
          finally { await file.close(); }
          await rename(temporary, this.filename);
        } finally { await rm(temporary, {force: true}); }
      };
      return await operation(state, save);
    } finally { await release?.(); }
  }
}
