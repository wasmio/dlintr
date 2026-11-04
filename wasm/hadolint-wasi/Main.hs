-- | The JS-facing reactor build of hadolint, for dlintr.
--
-- Exports @lint :: JSString -> IO JSString@ and @version :: IO JSString@ — the
-- shape upstream now ships in its own @exe:hadolint-embedded@ (hadolint#1271,
-- merged as 1d901b9), which is the shape this module was written against.
--
-- It keeps its own package rather than using that executable for one reason:
-- its entry point reads configuration from the environment the way the CLI does,
-- so @HADOLINT_TRUSTED_REGISTRIES@ and the rest keep working. Upstream's
-- embedded module lints with @def@.
module Main where

import Data.Default (def)
import Data.Sequence (singleton)
import Data.Text (Text)
import qualified Data.Text as Text
-- GHC-72317: `JSString` is only marshallable when its constructor is in
-- scope, so the `(..)` is load-bearing, not decoration.
import GHC.Wasm.Prim (JSString (..), fromJSString, toJSString)
import qualified Hadolint
import qualified Hadolint.Config as Config
import qualified Hadolint.Formatter.Format as Format
import qualified Hadolint.Formatter.Json as FormatJson
import qualified Hadolint.Lint as Lint
import qualified Language.Docker as Docker
import Language.Docker.Parser (DockerfileError, Error)
import Language.Docker.Syntax (Dockerfile)

-- A reactor is entered through its exports, never through `main`.
main :: IO ()
main = error "hadolint-wasi is a reactor: call `lint` or `version`"

foreign export javascript "version" version :: IO JSString

-- | The hadolint version string, exactly as the CLI's @--version@ prints it.
version :: IO JSString
version = pure (toJSString Hadolint.getVersion)

foreign export javascript "lint" lint :: JSString -> IO JSString

-- | Lint a Dockerfile and hand back the findings as JSON.
--
-- Configuration comes from the environment, the way @app/Main.hs@ does it, so
-- @HADOLINT_TRUSTED_REGISTRIES@ and the rest keep working. That is possible
-- because the reactor imports @environ_get@ — the same WASI import table as the
-- command build — so the host's @env@ is visible to 'System.Environment'.
lint :: JSString -> IO JSString
lint source = do
  fromEnvironment <- Config.getConfigFromEnvironment
  let config = Config.applyPartialConfiguration def fromEnvironment
  pure . toJSString . Text.unpack . FormatJson.render $
    [ analyse config (Docker.parseText (Text.pack (fromJSString source)))
    ]

analyse :: Config.Configuration -> Either Error Dockerfile -> Format.Result Text DockerfileError
analyse config parsed =
  case parsed of
    Left err -> Format.Result file (singleton err) mempty
    Right ast -> Format.Result file mempty (Lint.analyze config ast)
  where
    file = Text.pack "-"
