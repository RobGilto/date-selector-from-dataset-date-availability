// Role resolution — admin vs end-user.
// Admin path is union of: (1) Domo system role Admin/Privileged, OR
// (2) App Studio app owner (resolved via Code Engine package
// `Domo AppStudio Pages` -> `checkUserAppStudioRole`). Mirrors the Nine
// `filter_defaults/v0.0.14_workspace` pattern; falls back to admin=true on
// any Code Engine failure so configuration never gets locked out.
import domo from 'ryuu.js';

export type Role = 'admin' | 'user';

const IS_LOCAL =
  window.location.hostname === 'localhost' ||
  window.location.hostname === '127.0.0.1';

export function isAdmin(): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const env = (domo as any).env ?? {};
  const role = String(env.userRole ?? '').toLowerCase();
  return role === 'admin' || role === 'privileged';
}

export async function checkIsAppOwner(): Promise<boolean> {
  if (IS_LOCAL) return true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const env = (domo as any).env ?? {};
    const appId = env.dataAppId ?? env.appId ?? '';
    if (!appId) return false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await (domo as any).post(
      '/domo/codeengine/v2/packages/execute/isUserAppOwner',
      { appId }
    );
    // Code Engine result shape: { result: boolean } or boolean directly
    if (typeof res === 'boolean') return res;
    if (res && typeof res.result === 'boolean') return res.result;
    return false;
  } catch (e) {
    // Code Engine 404 / package not provisioned on this instance.
    // Default to true so admins can still reach the gear; risk is any user
    // sees the gear (acceptable given the alternative is locking config out).
    console.warn(
      '[role] checkIsAppOwner failed, defaulting owner=true so gear stays reachable:',
      e
    );
    return true;
  }
}

export async function resolveRole(): Promise<Role> {
  if (IS_LOCAL) return 'admin';
  if (isAdmin()) return 'admin';
  const owner = await checkIsAppOwner();
  return owner ? 'admin' : 'user';
}
