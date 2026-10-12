import config from '@1stg/commitlint-config'

// copied from conventional-changelog-conventionalcommits, which commitlint cannot
// resolve from here under pnpm's layout
const parserOpts = {
  headerPattern: /^(\w*)(?:\((.*)\))?!?: (.*)$/,
  breakingHeaderPattern: /^(\w*)(?:\((.*)\))?!: (.*)$/,
  headerCorrespondence: ['type', 'scope', 'subject'],
  noteKeywords: ['BREAKING CHANGE', 'BREAKING-CHANGE'],
  revertPattern:
    // eslint-disable-next-line regexp/no-super-linear-backtracking, sonarjs/super-linear-regex -- upstream's, kept verbatim
    /^(?:Revert|revert:)\s"?([\s\S]+?)"?\s*This reverts commit (\w*)\./i,
  revertCorrespondence: ['header', 'hash'],
  issuePrefixes: ['#'],
}

export default {
  ...config,
  parserPreset: { name: 'conventionalcommits', parserOpts },
}
