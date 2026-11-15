function assinaturaDaSessao(engine, auth) {
  return { kind: auth.kind, id: auth.id || '',
    settings: ['reviewModel', 'reviewEffort'].map(key => [key, engine.config?.[key]]) };
}

function conferirAssinatura(engine, opts, auth) {
  const expected = opts.sessionBinding;
  if (!expected) return;
  const actual = assinaturaDaSessao(engine, auth);
  if (['kind', 'id'].some(key => actual[key] !== expected[key])
    || expected.settings.some(([key, value]) => engine.config?.[key] !== value)) {
    throw Object.assign(new Error('o perfil ou modelo mudou; a conversa anterior não pode ser retomada neste perfil'), { continuationChanged: true });
  }
}

export { assinaturaDaSessao, conferirAssinatura };
