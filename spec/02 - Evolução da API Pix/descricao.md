# Evolução da API Pix

A API Pix busca respeitar __[SemVer](https://semver.org/lang/pt-BR/)__. Nesse sentido,
mudanças compatíveis não devem gerar nova versão _major_.

A versão da API é composta por 4 elementos: _major_, _minor_, _patch_ e _release candidate_.
A versão `v[x]`que consta no path da URL é o elemento _major_ da versão da API.
A evolução da versão se dá seguinte forma:

  - Major: alterações incompatíveis, com quebra de contrato (v1.0.0 → v2.0.0) 
  - Minor: alterações compatíveis, sem quebra de contrato (v1.1.0 → v1.2.0)
  - Patch: bugfixes, esclarecimentos às especificações, sem alterações funcionais (v1.1.1 → v1.1.2)
  - Release candidate: versões de pré-lançamento de qualquer patch futuro, minor ou major (v1.0.0-rc.1 → v1.0.0-rc.22)

Alterações sem quebra de contrato e esclarecimentos às especificações podem ocorrer a qualquer momento.
Clientes devem estar preparados para lidar com essas mudanças sem quebrar.

As seguintes mudanças são esperadas e consideradas retrocompatíveis:

- Adição de novos recursos na API Pix;
- Adição de novos parâmetros opcionais;
- Adição de novos campos em respostas da API Pix;
- Alteração da ordem de campos;
- Adição de novos elementos em enumerações.

