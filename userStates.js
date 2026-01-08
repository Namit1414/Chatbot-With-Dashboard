const userStates = new Map();

export function getUserState(phone) {
  return userStates.get(phone) || {
    step: 0,
    data: {}
  };
}

export function updateUserState(phone, state) {
  userStates.set(phone, state);
}

export function clearUserState(phone) {
  userStates.delete(phone);
}
