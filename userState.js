const users = new Map();

export function getUserState(phone) {
  return users.get(phone) || null;
}

export function setUserState(phone, state) {
  users.set(phone, state);
}

export function clearUserState(phone) {
  users.delete(phone);
}
