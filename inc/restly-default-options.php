<?php
if ( !defined( 'ABSPATH' ) ) {
    exit; // Exit if accessed directly
}
function restly_default_theme_options() {
    return array(
        'restly_copyright_text'   => wp_kses(
            __( '&copy; Copyright 2021 Restly All Rights Reserved', 'restly' ),
            array(
                'a'      => array(
                    'href' => array(),
                ),
                'strong' => array(),
                'small'  => array(),
                'span'   => array(),
            )
        ),

        'restly_not_found_text'   => wp_kses(
            __( '<h2> Oops! page not found.</h2><p>The page you are looking for is not available or doesn’t belong to this website!</p>', 'restly' ),
            array(
                'a'      => array(
                    'href' => array(),
                ),
                'strong' => array(),
                'small'  => array(),
                'span'   => array(),
                'p'      => array(),
                'h1'     => array(),
                'h2'     => array(),
                'h3'     => array(),
                'h4'     => array(),
                'h5'     => array(),
                'h6'     => array(),
            )
        ),
        'restly_blog_title'       => esc_html__( 'Blog Standard', 'restly' ),
        'restly_error_page_title' => esc_html__( 'Page not found.', 'restly' ),
    );
}

if ( !function_exists( 'restly_options' ) ) {
    function restly_options( $option = '', $default = null ) {
        $defaults = restly_default_theme_options();
        $options = get_option( 'restly_Theme_Option' );
        $default = ( !isset( $default ) && isset( $defaults[$option] ) ) ? $defaults[$option] : $default;
        return ( isset( $options[$option] ) ) ? $options[$option] : $default;
    }
}
add_filter( 'csf_welcome_page', '__return_false' );