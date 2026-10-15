-- | The JS-facing reactor build of hadolint, for dlintr.
--
-- Exports exactly the shape upstream proposes in hadolint#1271 —
-- @lint :: JSString -> IO JSString@ and @version :: IO JSString@ — so that when
-- the submodule moves past that change we can build @exe:hadolint-embedded@
-- instead and delete this package without touching a line of JavaScript or a
-- single test.
--
-- Why a local package is needed at all: v2.15.1 has no executable with that
-- signature. Its @hadolint-embedded@ is wired to the hadolint website's DOM —
-- it reads @#dockerfile__code@ and writes into @#version@ — and @exe:hadolint@
-- is a WASI /command/ that upstream marks unbuildable on wasm32.
--
-- CI builds it, and the byte-equality test exercises it: its output is compared
-- against the same commit's command build, byte for byte.
module Main where

import Data.Aeson (ToJSON (..), encode, object, (.=))
import qualified Data.ByteString.Lazy.Char8 as B
import Data.Default (def)
import Data.Sequence (singleton)
import Data.Text (Text)
import qualified Data.Text as Text
import qualified Data.Text.Encoding as Encoding
-- GHC-72317: `JSString` is only marshallable when its constructor is in
-- scope, so the `(..)` is load-bearing, not decoration.
import GHC.Wasm.Prim (JSString (..), fromJSString, toJSString)
import qualified Hadolint
import qualified Hadolint.Config as Config
import qualified Hadolint.Formatter.Format as Format
import qualified Hadolint.Lint as Lint
import Hadolint.Rule (CheckFailure (..), DLSeverity (..), unRuleCode)
import qualified Language.Docker as Docker
import Language.Docker.Parser (DockerfileError, Error)
import Language.Docker.Syntax (Dockerfile)
import Text.Megaparsec (TraversableStream)
import Text.Megaparsec.Error (ParseErrorBundle, ShowErrorComponent)
import Text.Megaparsec.Pos (sourceColumn, sourceLine, sourceName, unPos)
import Text.Megaparsec.Stream (VisualStream)

-- A reactor is entered through its exports, never through `main`. Upstream's
-- embedded build does the same, with the same `error` body.
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
  pure . toJSString . Text.unpack . Encoding.decodeUtf8 . B.toStrict . render $
    analyse config (Docker.parseText (Text.pack (fromJSString source)))

analyse :: Config.Configuration -> Either Error Dockerfile -> Format.Result Text DockerfileError
analyse config parsed =
  case parsed of
    Left err -> Format.Result file (singleton err) mempty
    Right ast -> Format.Result file mempty (Lint.analyze config ast)
  where
    file = Text.pack "-"

-- | The JSON the CLI's @--format json@ produces, byte for byte.
--
-- A port of @Hadolint.Formatter.Json@, which exposes only
-- @hWrite :: Handle -> f (Result s e) -> IO ()@. A reactor has no handle to
-- write to and needs the bytes back as a value, so the encoding is repeated
-- here. When the submodule moves past hadolint#1271 this disappears: that
-- change adds the pure @render@ these lines stand in for.
--
-- The field order matches upstream's because aeson 2 encodes an @Object@ with
-- its keys sorted, so writing the same @object [...]@ is enough. A test asserts
-- the equality against the CLI's output rather than assuming it.
render ::
  (VisualStream s, TraversableStream s, ShowErrorComponent e) =>
  Format.Result s e ->
  B.ByteString
render (Format.Result fileName errors checks) =
  encode (fmap JsonParseError errors <> fmap (JsonCheck fileName) checks)

data JsonFormat s e
  = JsonCheck Text CheckFailure
  | JsonParseError (ParseErrorBundle s e)

instance
  (VisualStream s, TraversableStream s, ShowErrorComponent e) =>
  ToJSON (JsonFormat s e)
  where
  toJSON (JsonCheck file CheckFailure {..}) =
    object
      [ "file" .= file,
        "line" .= line,
        "column" .= (1 :: Int),
        "level" .= Format.severityText severity,
        "code" .= unRuleCode code,
        "message" .= message
      ]
  toJSON (JsonParseError err) =
    object
      [ "file" .= sourceName pos,
        "line" .= unPos (sourceLine pos),
        "column" .= unPos (sourceColumn pos),
        "level" .= Format.severityText DLErrorC,
        "code" .= ("DL1000" :: Text),
        "message" .= Format.errorMessage err
      ]
    where
      pos = Format.errorPosition err
