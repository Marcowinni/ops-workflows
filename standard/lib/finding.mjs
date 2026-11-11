// A finding is one rule violation. severity "error" fails the step in
// mode=enforce; "warning" never does. In mode=warn nothing fails.

export function finding(id, message, file = null, severity = "error") {
  return { id, message, file, severity };
}
