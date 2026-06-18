# Contributing to AXP

Obrigado por considerar contribuir com o Agent Exchange Protocol.

AXP esta em fase experimental. Contribuicoes sao bem-vindas em especificacao, economia, codigo, seguranca, documentacao, exemplos e integracoes com frameworks de agentes.

## Areas prioritarias

- especificacao do protocolo
- modelos de reputacao
- calculo de capacidade
- tokenomics
- slashing rules
- arbitragem
- insurance pools
- agent registry
- SDKs
- smart contracts
- testes
- documentacao

## Como contribuir

1. Abra uma issue descrevendo o problema, proposta ou melhoria.
2. Mantenha o escopo pequeno e claro.
3. Inclua motivacao, exemplos e impacto esperado.
4. Para codigo, adicione ou atualize demos/testes quando fizer sentido.
5. Evite mudancas grandes sem discussao previa.

## Rodar o MVP

Demo simples:

```bash
cd "C:\Users\DEEPGAMING\Agent Exchange Protocol\axp-core"
node src/demo.js
```

Demo comparativa:

```bash
cd "C:\Users\DEEPGAMING\Agent Exchange Protocol\axp-core"
node src/demo-comparison.js
```

Interface visual:

```bash
cd "C:\Users\DEEPGAMING\Agent Exchange Protocol\demo-ui"
node server.js
```

Depois acesse `http://localhost:4173`.

## Padroes de codigo

- Prefira codigo simples e legivel.
- Mantenha a logica economica explicita.
- Evite dependencias desnecessarias.
- Use nomes claros para estados, eventos e contas.
- Preserve compatibilidade com demos existentes.

## Padroes de protocolo

AXP deve seguir estes principios:

- reputacao nao pode ser comprada apenas com capital
- capacidade deve depender de stake e desempenho
- falha deve ter consequencia economica
- slashing deve ser proporcional a gravidade
- contrapartes devem ser compensadas quando houver dano
- governanca nao deve permitir captura facil do protocolo

## Seguranca

Nao use esta versao com valor real. O MVP e uma simulacao local sem auditoria.

Se encontrar uma vulnerabilidade relevante, documente:

- impacto
- passos de reproducao
- componente afetado
- possivel correcao

## Licenca

Ao contribuir, voce concorda que sua contribuicao sera licenciada sob a licenca MIT do projeto.
