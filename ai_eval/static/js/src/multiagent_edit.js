/* Javascript for MultiAgentAIEvalXBlock. */
function MultiAgentAIEvalXBlock(runtime, element, data) {
    "use strict";

    StudioEditableXBlockMixin(runtime, element);

    var $fields = $('#xb-field-edit-scenario_data, #xb-field-edit-character_data');

    var addFileInput = function() {
        var $wrapper = $('<div/>');
        $wrapper.css('margin-left', 'calc(25% + 15px)');
        $wrapper.css('margin-top', '5px');
        var $fileInput = $('<input type="file"/>');
        $fileInput.css('width', 'calc(45% - 10px)');
        $wrapper.append($fileInput);
        var $loadButton = $('<button class="action" type="button"/>');
        $loadButton.append(gettext("Load"));
        $loadButton.click(loadFile);
        $loadButton.css('margin-left', '10px');
        $wrapper.append($loadButton);

        $(this).closest('.wrapper-comp-setting').append($wrapper);
    }

    var loadFile = function() {
        var $button = $(this);
        var $fileInput = $button.prev('input[type="file"]');
        var $field = $button.closest('.wrapper-comp-setting').children('textarea');
        var file = $fileInput[0].files[0];
        if (file !== undefined) {
            var reader = new FileReader();
            reader.onload = function(e) {
                $field.val(JSON.stringify(JSON.parse(e.target.result), null, 2));
                $field.trigger("change");
            }
            reader.readAsText(file);
        }
    }

    $fields.each(addFileInput);

    var addJSONEditor = function() {
        var $field = $(this);
        var $container = $('<div/>');
        $container.css('display', 'inline-block');
        $container.css('vertical-align', 'top');
        $container.css('width', '45%');
        $field.css('display', 'none');
        $container.insertAfter($field);
        var options = {
            enableSort: false,
            enableTransform: false,
            modes: ['tree', 'text'],
            navigationBar: false,
            search: false,
            onChangeText: function(value) {
                $field.val(value);
                $field.trigger("change");
            },
        };
        var editor = new JSONEditor($container[0], options);
        editor.setText($field.val());

        var $wrapper = $field.closest('li');
        var $resetButton = $wrapper.find('button.setting-clear');
        $resetButton.click(function() {
            editor.setText($field.val());
        });

        $field.on('change', function() {
            var value = $field.val();
            if (value !== editor.getText()) {
                editor.setText(value);
            }
        });
    }

    if (window.JSONEditor !== undefined) {
        $fields.each(addJSONEditor);
    } else {
        $('head').append($(
            '<link ' +
            'rel="stylesheet" ' +
            'href="https://cdnjs.cloudflare.com/ajax/libs/jsoneditor/10.1.1/' +
            'jsoneditor.min.css" ' +
            'integrity="sha512-8G+Vb2+10BSrSo+wupdzJIylDLpGtEYniQhp0rsbTigPG' +
            '7Onn2S08Ai/KEGlxN2Ncx9fGqVHtRehMuOjPb9f8g==" ' +
            'crossorigin="anonymous" ' +
            'referrerpolicy="no-referrer" />'
        ));
        var $jsoneditorIframe = $('<iframe>');
        $jsoneditorIframe.css('display', 'none');
        $jsoneditorIframe.on('load', function() {
            window.JSONEditor = $(this)[0].contentWindow.JSONEditor;
            $fields.each(addJSONEditor);
        });
        $jsoneditorIframe.attr('srcdoc', data.jsoneditor_html);
        $(document.body).append($jsoneditorIframe);
    }
}
