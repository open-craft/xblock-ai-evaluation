"""
Testing module.
"""

import unittest
from xblock.exceptions import JsonHandlerError
from xblock.field_data import DictFieldData
from xblock.test.toy_runtime import ToyRuntime
from ai_eval import CodingAIEvalXBlock, ShortAnswerAIEvalXBlock


class TestCodingAIEvalXBlock(unittest.TestCase):
    """Tests for CodingAIEvalXBlock"""

    def test_basics_student_view(self):
        """Test the basic view loads."""
        data = {
            "language": "Python",
            "question": "ca va?",
            "code": "",
            "ai_evaluation": "",
            "code_exec_result": {},
            "marked_html": '<!doctype html>\n<html lang="en">\n<head></head>\n<body>\n    <script '
            'type="text/javascript" src="https://cdnjs.cloudflare.com/ajax/libs/marked/13.0.2/marked'
            '.min.js"></script>\n</body>\n</html>',
            "monaco_html": '<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8" />\n'
            '  <title>Monaco Editor</title>\n</head>\n<body style="margin: 0;">\n  <div class="monaco"'
            ' style="width: 100vw; height: 100vh;"></div>\n  <script type="module">\n    import * as'
            ' monaco from "https://cdn.jsdelivr.net/npm/monaco-editor@0.49.0/+esm";\n\n    window.editor '
            '= monaco.editor.create(document.querySelector(".monaco"), {\n      language: "python",\n    '
            '  minimap: { enabled: false },\n      lineNumbersMinChars: 2,\n      folding: false,\n    });\n\n'
            '    window.parent.postMessage(\'__USAGE_ID_PLACEHOLDER__\', \'*\');\n  </script>\n</body>\n</html>\n',
        }
        block = CodingAIEvalXBlock(ToyRuntime(), DictFieldData(data), None)
        frag = block.student_view()
        self.assertEqual(data, frag.json_init_args)
        self.assertIn('<div class="eval-ai-container">', frag.content)


class TestShortAnswerAIEvalXBlock(unittest.TestCase):
    """Tests for ShortAnswerAIEvalXBlock"""

    data = {
        "question": "ca va?",
        "messages": {"USER": [], "LLM": []},
        "max_responses": 3,
        "marked_html": (
            '<!doctype html>\n<html lang="en">\n<head></head>\n<body>\n'
            '    <script type="text/javascript" '
            'src="https://cdnjs.cloudflare.com'
            '/ajax/libs/marked/13.0.2/marked.min.js"></script>\n'
            '</body>\n</html>'
        ),
    }

    def test_basics_student_view(self):
        """Test the basic view loads."""
        block = ShortAnswerAIEvalXBlock(
            ToyRuntime(),
            DictFieldData(self.data),
            None,
        )
        frag = block.student_view()
        self.assertEqual(frag.json_init_args, self.data)
        self.assertIn('<div class="shortanswer_block">', frag.content)

    def test_reset(self):
        """Test the reset function."""
        data = {
            **self.data,
            "allow_reset": True,
            "messages": {"USER": ["Hello"], "LLM": ["Hello"]},
        }
        block = ShortAnswerAIEvalXBlock(ToyRuntime(), DictFieldData(data), None)
        block.reset.__wrapped__(block, data={})
        self.assertEqual(block.messages, {"USER": [], "LLM": []})

    def test_reset_forbidden(self):
        """Test the reset function."""
        data = {
            **self.data,
            "messages": {"USER": ["Hello"], "LLM": ["Hello"]},
        }
        block = ShortAnswerAIEvalXBlock(ToyRuntime(), DictFieldData(data), None)
        with self.assertRaises(JsonHandlerError):
            block.reset.__wrapped__(block, data={})
        self.assertEqual(block.messages, {"USER": ["Hello"], "LLM": ["Hello"]})
