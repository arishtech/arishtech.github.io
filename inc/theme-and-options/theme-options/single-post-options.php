<?php
//Single Post
CSF::createSection($restlyThemeOption, array(
    'parent' => 'restly_page_options',
    'title'  => esc_html__('Single Post / Post Details', 'restly'),
    'icon'   => 'fa fa-pencil',
    'fields' => array(
        array(
            'id'       => 'restly_single_post_author',
            'type'     => 'switcher',
            'title'    => esc_html__('Post Author Name', 'restly'),
            'text_on'  => esc_html__('Yes', 'restly'),
            'text_off' => esc_html__('No', 'restly'),
            'desc'     => esc_html__('Hide or show author name on post details page.', 'restly'),
            'default'  => true
        ),
        array(
            'id'       => 'restly_single_post_date',
            'type'     => 'switcher',
            'title'    => esc_html__('Post Date', 'restly'),
            'text_on'  => esc_html__('Yes', 'restly'),
            'text_off' => esc_html__('No', 'restly'),
            'desc'     => esc_html__('Hide or show date on post details page.', 'restly'),
            'default'  => true
        ),

        array(
            'id'       => 'restly_single_post_cmnt',
            'type'     => 'switcher',
            'title'    => esc_html__('Post Comments Number', 'restly'),
            'text_on'  => esc_html__('Yes', 'restly'),
            'text_off' => esc_html__('No', 'restly'),
            'desc'     => esc_html__('Hide or show comments number on post details page.', 'restly'),
            'default'  => true
        ),

        array(
            'id'       => 'restly_single_post_cat',
            'type'     => 'switcher',
            'title'    => esc_html__('Post Categories', 'restly'),
            'text_on'  => esc_html__('Yes', 'restly'),
            'text_off' => esc_html__('No', 'restly'),
            'desc'     => esc_html__('Hide or show categories on post details page.', 'restly'),
            'default'  => true
        ),

        array(
            'id'       => 'restly_single_post_tag',
            'type'     => 'switcher',
            'title'    => esc_html__('Post Tags', 'restly'),
            'text_on'  => esc_html__('Yes', 'restly'),
            'text_off' => esc_html__('No', 'restly'),
            'desc'     => esc_html__('Hide or show tags on post details page.', 'restly'),
            'default'  => true
        ),
        array(
            'id'       => 'restly_post_top_share',
            'type'     => 'switcher',
            'title'    => esc_html__('Top Social Share icons', 'restly'),
            'text_on'  => esc_html__('Yes', 'restly'),
            'text_off' => esc_html__('No', 'restly'),
            'desc'     => esc_html__('Hide or show social share icons on post details page.', 'restly'),
            'default'  => false
        ),
        array(
            'id'       => 'restly_post_share',
            'type'     => 'switcher',
            'title'    => esc_html__('Social Share icons', 'restly'),
            'text_on'  => esc_html__('Yes', 'restly'),
            'text_off' => esc_html__('No', 'restly'),
            'desc'     => esc_html__('Hide or show social share icons on post details page.', 'restly'),
            'default'  => false
        ),
    ),
));