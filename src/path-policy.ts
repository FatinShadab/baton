const excluded = /^(?:\.env(?:\..*)?|.*\.(?:pem|key)|id_rsa.*|credentials.*|node_modules|\.git)$/i;

export function allowed(filename: string): boolean {
  return !filename.split(/[\\/]/).some((part) => excluded.test(part));
}
