<?php
CSF::createSection( $restlyThemeOption, array(
    'parent' => 'restly_page_options',
    'title'  => esc_html__( 'Error 404', 'restly' ),
    'icon'   => 'fa fa-exclamation-triangle',
    'fields' => array(

        array(
            'id'       => 'restly_error_page_banner',
            'type'     => 'switcher',
            'title'    => esc_html__( 'Enable Error Banner', 'restly' ),
            'default'  => true,
            'text_on'  => esc_html__( 'Yes', 'restly' ),
            'text_off' => esc_html__( 'No', 'restly' ),
            'desc'     => esc_html__( 'Enable or disable search page banner.', 'restly' ),
        ),
        array(
            'id'         => 'restly_error_page_title',
            'type'       => 'text',
            'title'      => esc_html__( 'Banner Title', 'restly' ),
            'desc'       => esc_html__( 'Type Banner Title Here.', 'restly' ),
            'dependency' => array( 'restly_error_page_banner', '==', 'true' ),
        ),
        array(
            'id'           => 'restly_error_image',
            'type'         => 'media',
            'title'        => esc_html__( 'Error Image', 'restly' ),
            'library'      => 'image',
            'button_title' => esc_html__( 'Upload Image', 'restly' ),
            'desc'         => esc_html__( 'Upload error page image', 'restly' ),
        ),
        array(
            'id'            => 'restly_not_found_text',
            'type'          => 'wp_editor',
            'title'         => esc_html__( 'Not Found Text', 'restly' ),
            'tinymce'       => true,
            'quicktags'     => true,
            'media_buttons' => false,
            'height'        => '150px',
            'desc'          => esc_html__( 'Type not found text here.', 'restly' ),
        ),

        array(
            'id'       => 'restly_go_back_home',
            'type'     => 'switcher',
            'title'    => esc_html__( 'Enable Go Back Home Button', 'restly' ),
            'text_on'  => esc_html__( 'Yes', 'restly' ),
            'text_off' => esc_html__( 'No', 'restly' ),
            'desc'     => esc_html__( 'Enable or disable go back home button.', 'restly' ),
            'default'  => true,
        ),
        array(
            'id'         => 'restly_error_page_button_text',
            'type'       => 'text',
            'dependency' => array( 'restly_go_back_home', '==', 'true' ),
            'title'      => esc_html__( 'Bottom Text', 'restly' ),
            'desc'       => esc_html__( 'Type Banner Title Here.', 'restly' ),
            'default'    => esc_html__( 'Go Back', 'restly' ),
        ),

    ),
) );