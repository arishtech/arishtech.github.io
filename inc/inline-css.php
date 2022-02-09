<?php
if ( class_exists( 'CSF' ) && has_nav_menu( 'mainmenu' ) ) {
    function restly_inline_style() {
        wp_enqueue_style( 'restly-inline', get_template_directory_uri() . '/assets/css/inline-style.css', array(), '1.0.0', 'all' );
        
        if(is_page() || is_singular('post') || is_singular('restly_project') || is_singular('restly_team') && get_post_meta(get_the_ID(), 'restly_metabox', true)) {
            $restlyMeta = get_post_meta(get_the_ID(), 'restly_metabox', true);
        } else {
            $restlyMeta = array();
        }
        $restly_header_styles = restly_options('restly_header_styles');
        if (is_array($restlyMeta) && array_key_exists('restly_meta_select_header', $restlyMeta) && $restlyMeta['restly_meta_select_header'] != 'default' && $restlyMeta['restly_meta_enable_header'] == true ) {
            $selectedHeader = $restlyMeta['restly_meta_select_header'];
        } else if (!empty($restly_header_styles) && class_exists( 'CSF' )) {
            $selectedHeader = restly_options('restly_header_styles');
        } else {
            $selectedHeader = 'three';
        }

        if ( $selectedHeader === 'one' ) {
            $restly_header1_menu_bg = restly_options( 'restly_header1_menu_bg' );
            $restly_inline = '
                .main-navigation ul li ul{
                    background-color: '.esc_attr($restly_header1_menu_bg['restly_hea1_submeni_bgc']).';
                }
                .main-navigation ul li ul li a{
                    color: '.esc_attr($restly_header1_menu_bg['restly_hea1_submeni_textc']).'
                }
                .main-navigation ul li ul li a:hover, .main-navigation ul li ul li.current-menu-item>a, .main-navigation ul li ul li.current_page_item>a, .main-navigation ul li ul li.current_page_ancestor>a{
                    color: '.esc_attr($restly_header1_menu_bg['restly_hea1_submeni_texthc']).';
                    background-color: '.esc_attr($restly_header1_menu_bg['restly_hea1_submeni_texthbg']).'
                }
            ';
        }
        if ( $selectedHeader === 'two' ) {
            $restly_he2_menus = restly_options( 'restly_header2_menu_bg' );
            $restly_inline = '
                .header-two .main-navigation ul li ul{
                    background-color: '.esc_attr($restly_he2_menus['restly_hea2_submeni_bgc']).';
                }
                .header-two .main-navigation ul li ul li a{
                    color: '.esc_attr($restly_he2_menus['restly_hea2_submeni_textc']).'
                }
                .header-two .main-navigation ul li ul li a:hover,.header-two .main-navigation ul li ul li.current-menu-item>a,.header-two .main-navigation ul li ul li.current_page_item>a,.header-two .main-navigation ul li ul li.current_page_ancestor>a{
                    color: '.esc_attr($restly_he2_menus['restly_hea2_submeni_texthc']).';
                   background-color: '.esc_attr($restly_he2_menus['restly_hea2_submeni_texthbg']).'
                }
            ';
        }
        if ( $selectedHeader === 'three' ) {
            $restly_he3_menus = restly_options( 'restly_header3_menu_bg' );
            $restly_inline = '
                .header-three .main-navigation ul li ul{
                    background-color: '.esc_attr($restly_he3_menus['restly_hea3_submeni_bgc']).';
                }
                .header-three .main-navigation ul li ul li a{
                    color: '.esc_attr($restly_he3_menus['restly_hea3_submeni_textc']).'
                }
                .header-three .main-navigation ul li ul li a:hover,.header-three .main-navigation ul li ul li.current-menu-item>a,.header-three .main-navigation ul li ul li.current_page_item>a,.header-three .main-navigation ul li ul li.current_page_ancestor>a{
                    color: '.esc_attr($restly_he3_menus['restly_hea3_submeni_texthc']).';
                   background-color: '.esc_attr($restly_he3_menus['restly_hea3_submeni_texthbg']).'
                }
            ';
        }
        $restly_css_editor = restly_options( 'restly_css_editor' );
        if(!empty($restly_css_editor)){
            $restly_inline.=''.esc_attr($restly_css_editor).'';
        }
        wp_add_inline_style( 'restly-inline', $restly_inline );
    }
}
add_action( 'wp_enqueue_scripts', 'restly_inline_style' );