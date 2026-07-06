export function parsePoMsgids(source) {
  const messages = []
  let currentMsgid = null

  function finishMsgid() {
    if (currentMsgid !== null && currentMsgid !== "") {
      messages.push(currentMsgid)
    }
    currentMsgid = null
  }

  for (const line of source.split(/\r?\n/)) {
    if (line.startsWith("#~")) {
      finishMsgid()
      continue
    }
    if (line.trim() === "") {
      finishMsgid()
      continue
    }
    if (line.startsWith("msgid ")) {
      finishMsgid()
      currentMsgid = unquotePo(line.slice("msgid ".length))
      continue
    }
    if (currentMsgid !== null && line.startsWith('"')) {
      currentMsgid += unquotePo(line)
      continue
    }
    finishMsgid()
  }

  finishMsgid()
  return messages
}

function unquotePo(value) {
  return JSON.parse(value)
}
